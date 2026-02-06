"use client";

import { useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";

const sanitizeNumericDot = (value) => {
  const raw = String(value ?? "");
  const cleaned = raw.replace(/[^0-9.]/g, "");
  // allow a single dot
  return cleaned.replace(/(\..*)\./g, "$1");
};

const escapeWifi = (value) => {
  // Escape characters required by WIFI QR payload format
  return String(value ?? "").replace(/[\\;,:\"]/g, (m) => `\\${m}`);
};

const safeFilename = (value) => {
  const base = String(value ?? "").trim() || "qr";
  return base.replace(/[^a-z0-9-_]/gi, "_");
};

// Output size for NIIMBOT B1 labels (50x30mm, horizontal). Aspect ratio must be 5:3.
// Using 1000x600 yields good sharpness while keeping files manageable.
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
  // Use top baseline so vertical layout is predictable
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

    // Pre-calc sizes
    const wifiTargetH = 56;
    const wifiScale = wifiTargetH / wifiImg.height;
    const wifiW = Math.round(wifiImg.width * wifiScale);
    const wifiH = Math.round(wifiImg.height * wifiScale);

    const logoMaxW = labelW - padX * 2;
    const logoTargetH = 92;
    const logoScale = Math.min(logoMaxW / logoImg.width, logoTargetH / logoImg.height);
    const logoW = Math.round(logoImg.width * logoScale);
    const logoH = Math.round(logoImg.height * logoScale);

    // Fit/pack everything vertically so footer always stays below text
    let qrSize = 440;
    let passStartPx = 88;
    let ssidStartPx = 56;
    let netStartPx = 74;

    const passText = item?.isOpen ? "OPEN" : String(item?.password || "");
    const ssidText = String(item?.ssid || "");
    const netText = String(item?.networkType || "");

    const gapLogoQr = 22;
    // text block spacing (tight but readable)
    let gapQrText = 38;
    const gapPassSsid = 6;
    const gapSsidNet = 4;
    const gapNetFooter = 14;

    const availH = labelH - padTop - padBottom;
    const footerTop = labelH - padBottom - wifiH;

    for (let i = 0; i < 18; i += 1) {
      // Determine fitted font sizes at current start sizes
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

      // Text block anchored above footer
      const netTop = footerTop - gapNetFooter - netPx;
      const ssidTop = netTop - gapSsidNet - ssidPx;
      const passTop = ssidTop - gapPassSsid - passPx;

      // QR anchored below logo
      const qrTop = padTop + logoH + gapLogoQr;

      const fits =
        passTop >= qrTop + qrSize + gapQrText &&
        // also ensure top padding isn't exceeded
        qrTop + qrSize <= footerTop - gapNetFooter - (passPx + ssidPx + netPx + gapPassSsid + gapSsidNet);

      const required =
        (qrTop - padTop) +
        qrSize +
        gapQrText +
        (footerTop - passTop) +
        wifiH;

      if (fits && required <= availH) break;

      // First reduce QR size, then reduce gap between QR and text, then shrink fonts.
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

    // Logo (top)
    let y = padTop;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logoImg, Math.round(centerX - logoW / 2), y, logoW, logoH);
    y += logoH + gapLogoQr;

    // QR (big)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrImg, Math.round(centerX - qrSize / 2), y, qrSize, qrSize);
    // Lay out texts from bottom to top so footer never overlaps.
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

    // If text block would collide with QR, pull it up a bit by reducing gap.
    // (Packing loop should prevent this, but keep a safe guard.)
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

    // WiFi footer icon BELOW the text (never above it)
    ctx.globalAlpha = 0.75;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(wifiImg, Math.round(centerX - wifiW / 2), footerY, wifiW, wifiH);
    ctx.globalAlpha = 1;

    if (!ROTATE_CONTENT_FOR_HORIZONTAL_LABEL) return canvas.toDataURL("image/png");
    const out = rotateCanvas90CWTo(canvas, LABEL_OUT_PX.w, LABEL_OUT_PX.h);
    return (out || canvas).toDataURL("image/png");
  };

  const buildAttentionStickerPng = async () => {
    const { canvas, w: labelW, h: labelH } = makeStickerCanvas();
    const padX = 55;
    const padTop = 65;
    const centerX = labelW / 2;
    const maxTextW = labelW - padX * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, labelW, labelH);
    ctx.fillStyle = "#000000";

    const qrImg = await loadImage("/Red7QR.png");

    // Header text (two lines for better balance)
    let y = padTop;
    const line1 = "¡Atención al cliente";
    const line2 = "por WhatsApp!";

    const line1Px = drawCenteredText(ctx, {
      text: line1,
      centerX,
      y,
      maxWidth: maxTextW,
      weight: 900,
      startPx: 54,
      minPx: 34,
    });
    y += line1Px + 10;

    const line2Px = drawCenteredText(ctx, {
      text: line2,
      centerX,
      y,
      maxWidth: maxTextW,
      weight: 900,
      startPx: 54,
      minPx: 34,
    });
    y += line2Px + 26;

    // QR image (square, centered)
    const qrMaxSize = 520;
    const availH = labelH - y - 55;
    const target = Math.max(260, Math.min(qrMaxSize, Math.min(labelW - padX * 2, availH)));
    const scale = Math.min(target / qrImg.width, target / qrImg.height);
    const qrW = Math.round(qrImg.width * scale);
    const qrH = Math.round(qrImg.height * scale);
    const qrX = Math.round(centerX - qrW / 2);
    const qrY = Math.round(y);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrImg, qrX, qrY, qrW, qrH);

    if (!ROTATE_CONTENT_FOR_HORIZONTAL_LABEL) return canvas.toDataURL("image/png");
    const out = rotateCanvas90CWTo(canvas, LABEL_OUT_PX.w, LABEL_OUT_PX.h);
    return (out || canvas).toDataURL("image/png");
  };

  const handleDownload = (index) => {
    setPrintIndex(index);
    setTimeout(() => {
      (async () => {
        const qrDataUrl = capturePrintCanvasPng();
        const item = qrs[index] || null;
        if (!qrDataUrl || !item) {
          setPrintIndex(null);
          return;
        }

        let sticker = null;
        try {
          sticker = await buildWifiStickerPng(item, qrDataUrl);
        } catch {
          sticker = null;
        }

        if (!sticker) {
          // fallback: download only QR
          const a = document.createElement("a");
          a.href = qrDataUrl;
          a.download = `${safeFilename(item.ssid)}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setPrintIndex(null);
          return;
        }

        const a = document.createElement("a");
        a.href = sticker;
        a.download = `${safeFilename(item.ssid)}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setPrintIndex(null);
      })();
    }, 160);
  };

  const handlePrintRedQr = () => {
    (async () => {
      let sticker = null;
      try {
        sticker = await buildAttentionStickerPng();
      } catch {
        sticker = null;
      }

      const a = document.createElement("a");
      a.href = sticker || "/Red7QR.png";
      a.download = "atencion-whatsapp.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    })();
  };

  return (
    <div className="page-container generar-qr-page">
      <div className="operacion-scope no-print">
        <section className="form-card">
          <div className="form-header no-print">
            <h2>GENERADOR DE QR WIFI</h2>
            <p>Genera e imprime etiquetas (una por una).</p>
          </div>

          <div className="no-print form-grid">
            <div className="form-field">
              <label className="form-label">Nombre de la Red (SSID)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Red_Cliente_23"
                value={ssid}
                onChange={(e) => {
                  setSsid(e.target.value);
                  setError("");
                }}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Tipo de red</label>
              <input
                type="text"
                className="form-input"
                value={networkType}
                inputMode="decimal"
                pattern="^[0-9]*\\.?[0-9]*$"
                placeholder="5.0"
                onChange={(e) => {
                  setNetworkType(sanitizeNumericDot(e.target.value));
                  setError("");
                }}
              />
            </div>

            {!isOpen ? (
              <div className="form-field">
                <label className="form-label">Contraseña</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Contraseña del WiFi"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                />
              </div>
            ) : (
              <div className="form-field" />
            )}

            <div className="ot-checkbox-group form-grid-full">
              <label>
                <input
                  type="checkbox"
                  checked={isOpen}
                  onChange={() => {
                    setIsOpen(!isOpen);
                    setError("");
                  }}
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
              <button
                type="button"
                onClick={handlePrintRedQr}
                className="btn btn-primary"
              >
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
                  <div key={i} className="qr-list-item">
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

      {/* Hidden canvas used to capture QR for printing/download */}
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
