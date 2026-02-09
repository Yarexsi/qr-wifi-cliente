"use client";

import { useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

const sanitizeNumericDot = (value) => {
  const raw = String(value ?? "");
  const cleaned = raw.replace(/[^0-9.]/g, "");
  return cleaned.replace(/(\..*)\./g, "$1");
};

const escapeWifi = (value) => String(value ?? "").replace(/[\\;,:\"]/g, (m) => `\\${m}`);

const safeFilename = (value) => {
  const base = String(value ?? "").trim() || "qr";
  return base.replace(/[^a-z0-9-_]/gi, "_");
};

// Output size for NIIMBOT B1 labels (50x30mm, horizontal). Aspect ratio must be 5:3.
const LABEL_OUT_PX = { w: 1000, h: 600 };

// NIIMBOT app may rotate the label “sheet” without rotating the imported image.
// To keep the content aligned with the horizontal label, we render in portrait base
// (same pixels swapped) and rotate the final bitmap 90° clockwise.
const ROTATE_CONTENT_FOR_HORIZONTAL_LABEL = true;

const rotateCanvas90CWTo = (srcCanvas, outW, outH) => {
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  // Map src (w x h) -> out (h x w) via 90° clockwise rotation.
  ctx.translate(outW, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(srcCanvas, 0, 0);
  return out;
};

const getBackgroundBoundsFromImage = (
  img,
  { alphaThreshold = 10, tolerance = 24, sampleSize = 12, lumaDelta = 10 } = {}
) => {
  const w = Math.max(1, Math.floor(img.naturalWidth || img.width || 1));
  const h = Math.max(1, Math.floor(img.naturalHeight || img.height || 1));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w, h };

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const read = (sx, sy, sw, sh) => {
    try {
      return ctx.getImageData(sx, sy, sw, sh);
    } catch {
      return null;
    }
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const s = clamp(sampleSize, 1, Math.min(w, h));

  // Estimate background from 4 corners.
  const cornerRects = [
    { x: 0, y: 0 },
    { x: w - s, y: 0 },
    { x: 0, y: h - s },
    { x: w - s, y: h - s },
  ];

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (const p of cornerRects) {
    const id = read(p.x, p.y, s, s);
    if (!id) continue;
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a <= alphaThreshold) continue;
      sumR += d[i];
      sumG += d[i + 1];
      sumB += d[i + 2];
      count += 1;
    }
  }

  // Fallback: if we couldn't sample, return full image.
  if (count <= 0) return { x: 0, y: 0, w, h };

  const bgR = sumR / count;
  const bgG = sumG / count;
  const bgB = sumB / count;
  const bgL = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB;

  const full = read(0, 0, w, h);
  if (!full) return { x: 0, y: 0, w, h };
  const data = full.data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      const i = row + x * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a <= alphaThreshold) continue;
      const dr = r - bgR;
      const dg = g - bgG;
      const db = b - bgB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Treat pixels close to the background as empty margin.
      // Also ignore "almost background" bright pixels even if compression noise pushes dist up.
      if (dist <= tolerance && luma >= bgL - lumaDelta) continue;
      if (luma >= bgL - Math.max(3, lumaDelta / 2) && dist <= tolerance * 2) continue;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

const makeStickerCanvas = () => {
  if (!ROTATE_CONTENT_FOR_HORIZONTAL_LABEL) {
    const c = document.createElement("canvas");
    c.width = LABEL_OUT_PX.w;
    c.height = LABEL_OUT_PX.h;
    return { canvas: c, w: LABEL_OUT_PX.w, h: LABEL_OUT_PX.h };
  }
  // portrait base that rotates into 50x30 horizontal output
  const c = document.createElement("canvas");
  c.width = LABEL_OUT_PX.h;
  c.height = LABEL_OUT_PX.w;
  return { canvas: c, w: LABEL_OUT_PX.h, h: LABEL_OUT_PX.w };
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar la imagen: ${src}`));
    img.src = src;
  });

const setFont = (ctx, { weight = 700, sizePx = 48 } = {}) => {
  ctx.font = `${weight} ${sizePx}px Arial, Helvetica, sans-serif`;
};

const fitTextSize = (ctx, { text, maxWidth, weight = 800, startPx, minPx }) => {
  let sizePx = startPx;
  while (sizePx > minPx) {
    setFont(ctx, { weight, sizePx });
    if (ctx.measureText(text).width <= maxWidth) return sizePx;
    sizePx -= 2;
  }
  return minPx;
};

const drawCenteredText = (ctx, { text, centerX, y, maxWidth, weight, startPx, minPx }) => {
  const sizePx = fitTextSize(ctx, { text, maxWidth, weight, startPx, minPx });
  setFont(ctx, { weight, sizePx });
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(text, centerX, y);
  return sizePx;
};

export default function Page() {
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [networkType, setNetworkType] = useState("5.0");
  const [error, setError] = useState("");
  const [qrs, setQrs] = useState([]);
  const [printIndex, setPrintIndex] = useState(null);

  const canAdd = useMemo(() => {
    const cleanedSsid = String(ssid || "").trim();
    if (!cleanedSsid) return false;
    if (isOpen) return true;
    return String(password || "").trim().length > 0;
  }, [ssid, password, isOpen]);

  const generateValue = (item) => {
    const cleanedSsid = String(item?.ssid || "").trim();
    const escapedSsid = escapeWifi(cleanedSsid);
    if (item?.isOpen) return `WIFI:T:nopass;S:${escapedSsid};;`;

    const cleanedPassword = String(item?.password || "").trim();
    const escapedPassword = escapeWifi(cleanedPassword);
    return `WIFI:T:WPA;S:${escapedSsid};P:${escapedPassword};;`;
  };

  const handleAdd = () => {
    const cleanedSsid = String(ssid || "").trim();
    const cleanedPassword = String(password || "").trim();
    const cleanedNetworkType = String(networkType || "").trim() || "5.0";
    const finalNetworkType = sanitizeNumericDot(cleanedNetworkType) || cleanedNetworkType;

    if (!cleanedSsid) {
      setError("Ingresa el SSID.");
      return;
    }
    if (!isOpen && !cleanedPassword) {
      setError("Ingresa la contraseña o marca Red abierta.");
      return;
    }

    setQrs((prev) => [
      ...prev,
      { ssid: cleanedSsid, password: cleanedPassword, isOpen, networkType: finalNetworkType },
    ]);

    setSsid("");
    setPassword("");
    setIsOpen(false);
    setNetworkType("5.0");
    setError("");
  };

  const capturePrintCanvasPng = () => {
    const canvas = document.getElementById("print-canvas");
    const elCanvas =
      canvas && canvas.nodeName === "CANVAS" ? canvas : document.querySelector("#print-canvas canvas");
    if (!elCanvas || typeof elCanvas.toDataURL !== "function") return null;
    try {
      return elCanvas.toDataURL("image/png");
    } catch {
      return null;
    }
  };

  const buildWifiStickerPng = async (item, qrDataUrl) => {
    // Render on a base canvas; rotate to final 50x30 horizontal if needed.
    const { canvas, w: labelW, h: labelH } = makeStickerCanvas();
    const padX = 55;
    const padTop = 55;
    const padBottom = 55;
    const centerX = labelW / 2;
    const maxTextW = labelW - padX * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, labelW, labelH);
    ctx.fillStyle = "#000000";

    const [logoImg, wifiImg, qrImg] = await Promise.all([
      loadImage("/logo-red7-dark.png"),
      loadImage("/wifi-footer%20copy.svg"),
      loadImage(qrDataUrl),
    ]);

    const wifiTargetH = 56;
    const wifiScale = wifiTargetH / wifiImg.height;
    const wifiW = Math.round(wifiImg.width * wifiScale);
    const wifiH = Math.round(wifiImg.height * wifiScale);

    const logoMaxW = labelW - padX * 2;
    const logoTargetH = 92;
    const logoScale = Math.min(logoMaxW / logoImg.width, logoTargetH / logoImg.height);
    const logoW = Math.round(logoImg.width * logoScale);
    const logoH = Math.round(logoImg.height * logoScale);

    let qrSize = 440;
    let passStartPx = 88;
    let ssidStartPx = 56;
    let netStartPx = 74;

    const passText = item?.isOpen ? "OPEN" : String(item?.password || "");
    const ssidText = String(item?.ssid || "");
    const netText = String(item?.networkType || "");

    const gapLogoQr = 22;
    let gapQrText = 38;
    const gapPassSsid = 6;
    const gapSsidNet = 4;
    const gapNetFooter = 14;

    const availH = labelH - padTop - padBottom;
    const footerTop = labelH - padBottom - wifiH;

    for (let i = 0; i < 18; i += 1) {
      const passPx = fitTextSize(ctx, {
        text: passText,
        maxWidth: maxTextW,
        weight: 900,
        startPx: passStartPx,
        minPx: 42,
      });
      const ssidPx = fitTextSize(ctx, {
        text: ssidText,
        maxWidth: maxTextW,
        weight: 800,
        startPx: ssidStartPx,
        minPx: 28,
      });
      const netPx = fitTextSize(ctx, {
        text: netText,
        maxWidth: maxTextW,
        weight: 900,
        startPx: netStartPx,
        minPx: 34,
      });

      const netTop = footerTop - gapNetFooter - netPx;
      const ssidTop = netTop - gapSsidNet - ssidPx;
      const passTop = ssidTop - gapPassSsid - passPx;

      const qrTop = padTop + logoH + gapLogoQr;

      const fits =
        passTop >= qrTop + qrSize + gapQrText &&
        qrTop + qrSize <= footerTop - gapNetFooter - (passPx + ssidPx + netPx + gapPassSsid + gapSsidNet);

      const required = (qrTop - padTop) + qrSize + gapQrText + (footerTop - passTop) + wifiH;

      if (fits && required <= availH) break;

      if (qrSize > 360) {
        qrSize -= 12;
        continue;
      }
      if (gapQrText > 26) {
        gapQrText -= 4;
        continue;
      }
      passStartPx = Math.max(60, passStartPx - 4);
      ssidStartPx = Math.max(40, ssidStartPx - 3);
      netStartPx = Math.max(52, netStartPx - 3);
    }

    let y = padTop;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logoImg, Math.round(centerX - logoW / 2), y, logoW, logoH);
    y += logoH + gapLogoQr;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrImg, Math.round(centerX - qrSize / 2), y, qrSize, qrSize);

    const footerY = labelH - padBottom - wifiH;

    const netPx = fitTextSize(ctx, {
      text: netText,
      maxWidth: maxTextW,
      weight: 900,
      startPx: netStartPx,
      minPx: 34,
    });
    const ssidPx = fitTextSize(ctx, {
      text: ssidText,
      maxWidth: maxTextW,
      weight: 800,
      startPx: ssidStartPx,
      minPx: 28,
    });
    const passPx = fitTextSize(ctx, {
      text: passText,
      maxWidth: maxTextW,
      weight: 900,
      startPx: passStartPx,
      minPx: 42,
    });

    const netTop = footerY - gapNetFooter - netPx;
    const ssidTop = netTop - gapSsidNet - ssidPx;
    const passTop = ssidTop - gapPassSsid - passPx;

    const minTextTop = y + qrSize + gapQrText;
    const shiftUp = Math.max(0, minTextTop - passTop);

    drawCenteredText(ctx, {
      text: passText,
      centerX,
      y: passTop + shiftUp,
      maxWidth: maxTextW,
      weight: 900,
      startPx: passStartPx,
      minPx: 42,
    });
    drawCenteredText(ctx, {
      text: ssidText,
      centerX,
      y: ssidTop + shiftUp,
      maxWidth: maxTextW,
      weight: 800,
      startPx: ssidStartPx,
      minPx: 28,
    });
    drawCenteredText(ctx, {
      text: netText,
      centerX,
      y: netTop + shiftUp,
      maxWidth: maxTextW,
      weight: 900,
      startPx: netStartPx,
      minPx: 34,
    });

    ctx.globalAlpha = 0.75;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(wifiImg, Math.round(centerX - wifiW / 2), footerY, wifiW, wifiH);
    ctx.globalAlpha = 1;

    if (!ROTATE_CONTENT_FOR_HORIZONTAL_LABEL) return canvas.toDataURL("image/png");
    const out = rotateCanvas90CWTo(canvas, LABEL_OUT_PX.w, LABEL_OUT_PX.h);
    return (out || canvas).toDataURL("image/png");
  };

  const buildAttentionStickerPng = async () => {
    const labelW = LABEL_OUT_PX.w;
    const labelH = LABEL_OUT_PX.h;
    const padX = 30;
    const padY = 40;
    // Layout tuning for 50x30mm (1000x600px): keep bands readable without clipping.
    const gapAttentionQr = 2;
    const gapQrToSeparator = 8;
    const separatorW = 2;
    const gapSeparatorToContact = 10;
    const attentionBandW = 260;
    const contactLine1 = "Llámanos:";
    const contactLine2 = "(664) 954 6020";

    const canvas = document.createElement("canvas");
    canvas.width = labelW;
    canvas.height = labelH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, labelW, labelH);
    ctx.fillStyle = "#000000";

    const qrImg = await loadImage("/redqr.png");

    const line1 = "¡Atención al cliente";
    const line2 = "por WhatsApp!";

    const innerH = labelH - padY * 2;
    const qrSize = innerH;
    const contactBandW = Math.max(
      120,
      labelW -
        padX * 2 -
        attentionBandW -
        qrSize -
        gapAttentionQr -
        gapQrToSeparator -
        separatorW -
        gapSeparatorToContact
    );

    const drawVerticalTwoLine = ({
      bandCenterX,
      bandCenterY,
      maxLen,
      t1,
      t2,
      weight = 900,
      startPx = 72,
      minPx = 42,
      lineGap = 18,
      maxStackPx = null,
    }) => {
      // First, fit each line to the available length (label height).
      let t1Px = fitTextSize(ctx, { text: t1, maxWidth: maxLen, weight, startPx, minPx });
      let t2Px = fitTextSize(ctx, { text: t2, maxWidth: maxLen, weight, startPx, minPx });

      // Then, ensure the 2-line stack also fits within the band's thickness (to avoid clipping).
      if (typeof maxStackPx === "number" && Number.isFinite(maxStackPx)) {
        const floor = Math.max(18, minPx);
        for (let i = 0; i < 60; i += 1) {
          const total = t1Px + lineGap + t2Px;
          if (total <= maxStackPx) break;
          // Prefer shrinking the first line slightly ("Llámanos") to preserve the number.
          if (t1Px > floor) t1Px -= 2;
          if (t1Px + lineGap + t2Px <= maxStackPx) break;
          if (t2Px > floor) t2Px -= 2;
          if (t1Px <= floor && t2Px <= floor) break;
        }
      }

      const total = t1Px + lineGap + t2Px;

      ctx.save();
      ctx.translate(Math.round(bandCenterX), Math.round(bandCenterY));
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      setFont(ctx, { weight, sizePx: t1Px });
      ctx.fillText(t1, 0, -total / 2 + t1Px / 2);
      setFont(ctx, { weight, sizePx: t2Px });
      ctx.fillText(t2, 0, total / 2 - t2Px / 2);
      ctx.restore();
    };

    const drawVerticalSingle = ({ bandCenterX, bandCenterY, maxLen, text }) => {
      const px = fitTextSize(ctx, { text, maxWidth: maxLen, weight: 900, startPx: 62, minPx: 34 });
      ctx.save();
      ctx.translate(Math.round(bandCenterX), Math.round(bandCenterY));
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      setFont(ctx, { weight: 900, sizePx: px });
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };

    let x = padX;

    // 1) Atención (vertical)
    drawVerticalTwoLine({
      bandCenterX: x + attentionBandW / 2,
      bandCenterY: labelH / 2,
      maxLen: innerH,
      t1: line1,
      t2: line2,
      // Attention block has plenty of thickness; keep default sizing.
      maxStackPx: attentionBandW - 16,
    });
    x += attentionBandW + gapAttentionQr;

    // 2) QR rotated -90° (same orientation as the vertical text)
    const qrX = x;
    const qrY = padY;
    const qrCX = qrX + qrSize / 2;
    const qrCY = qrY + qrSize / 2;
    const scale = Math.min(qrSize / qrImg.width, qrSize / qrImg.height);
    const drawW = Math.round(qrImg.width * scale);
    const drawH = Math.round(qrImg.height * scale);

    ctx.save();
    ctx.translate(Math.round(qrCX), Math.round(qrCY));
    ctx.rotate(-Math.PI / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrImg, Math.round(-drawW / 2), Math.round(-drawH / 2), drawW, drawH);
    ctx.restore();

    x += qrSize;

    // 3) Separator line (between QR and contact)
    x += gapQrToSeparator;
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.globalAlpha = 0.65;
    ctx.fillRect(Math.round(x), padY, separatorW, innerH);
    ctx.restore();
    x += separatorW + gapSeparatorToContact;

    // 4) Llámanos (vertical) - slightly smaller so the number never clips.
    drawVerticalTwoLine({
      bandCenterX: x + contactBandW / 2,
      bandCenterY: labelH / 2,
      maxLen: innerH,
      t1: contactLine1,
      t2: contactLine2,
      startPx: 62,
      minPx: 30,
      lineGap: 12,
      maxStackPx: contactBandW - 10,
    });

    return canvas.toDataURL("image/png");
  };

  const handleDownload = (index) => {
    setPrintIndex(index);
    setTimeout(() => {
      (async () => {
        try {
          const qrDataUrl = capturePrintCanvasPng();
          const item = qrs[index] || null;
          if (!qrDataUrl || !item) return;

          let sticker = null;
          try {
            sticker = await buildWifiStickerPng(item, qrDataUrl);
          } catch {
            sticker = null;
          }

          const a = document.createElement("a");
          a.href = sticker || qrDataUrl;
          a.download = `${safeFilename(item.ssid)}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } finally {
          setPrintIndex(null);
        }
      })();
    }, 160);
  };

  const handleDownloadAttention = () => {
    const a = document.createElement("a");
    a.href = "/redqr.png";
    a.download = "Atencion al cliente.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="page-container generar-qr-page">
      <div className="operacion-scope">
        <section className="form-card">
          <div className="form-header">
            <h2>Generador de QR WiFi</h2>
            <p>Descarga la etiqueta lista para NIIMBOT (50×30mm)</p>
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label className="form-label" htmlFor="ssid">
                SSID
              </label>
              <input
                id="ssid"
                className="form-input"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                placeholder="Nombre de la red"
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="networkType">
                Tipo de red
              </label>
              <select
                id="networkType"
                className="form-input"
                value={networkType}
                onChange={(e) => setNetworkType(e.target.value)}
              >
                <option value="2.4">2.4</option>
                <option value="5.0">5.0</option>
              </select>
            </div>

            <div className="form-field form-grid-full">
              <label className="form-label" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isOpen ? "Sin contraseña" : "Contraseña"}
                disabled={isOpen}
              />
            </div>

            <div className="form-grid-full ot-checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={isOpen}
                  onChange={(e) => setIsOpen(e.target.checked)}
                />
                <span>Red abierta (sin contraseña)</span>
              </label>
            </div>

            {error && <div className="form-warning form-grid-full">{error}</div>}

            <div className="form-grid-full">
              <button type="button" onClick={handleAdd} className="form-button" disabled={!canAdd}>
                Agregar
              </button>
            </div>

            <div className="form-grid-full" style={{ textAlign: "center" }}>
              QRs agregados: <strong>{qrs.length}</strong>
            </div>

            <div className="actions-row form-grid-full">
              <button type="button" onClick={handleDownloadAttention} className="btn btn-primary">
                QR de atención al cliente
              </button>
            </div>
          </div>

          {qrs.length > 0 && (
            <div className="print-summary no-print">
              <p>
                <strong>Etiquetas guardadas:</strong> {qrs.length}
              </p>
              <div className="qr-list">
                {qrs.map((item, i) => (
                  <div key={`${item.ssid}-${i}`} className="qr-list-item">
                    <div className="qr-list-text">
                      <div>
                        <strong>SSID:</strong> {item.ssid}
                      </div>
                      <div>
                        <strong>Red:</strong> {item.networkType}
                        {item.isOpen ? "" : " | "}
                        {item.isOpen ? "" : (
                          <>
                            <strong>Pass:</strong> {item.password}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="qr-list-actions">
                      <button type="button" className="btn btn-primary" onClick={() => handleDownload(i)}>
                        Descargar
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setQrs((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Hidden canvas used to capture WiFi QR for download */}
      <div
        style={{ position: "absolute", left: -9999, top: 0, width: 1, height: 1, overflow: "hidden" }}
        aria-hidden="true"
      >
        {printIndex != null && qrs[printIndex] && (
          <QRCodeCanvas id="print-canvas" value={generateValue(qrs[printIndex])} size={512} />
        )}
      </div>
    </div>
  );
}
