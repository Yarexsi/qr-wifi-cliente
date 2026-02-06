"use client";

import { useEffect, useMemo, useState } from "react";
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

const waitForAllImages = (doc, timeoutMs = 800) => {
  try {
    const images = Array.from(doc.images || []);
    if (!images.length) return Promise.resolve();

    const done = () => images.every((img) => img.complete);
    if (done()) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const t = setTimeout(finish, timeoutMs);

      images.forEach((img) => {
        const handler = () => {
          if (done()) {
            clearTimeout(t);
            finish();
          }
        };
        img.addEventListener("load", handler, { once: true });
        img.addEventListener("error", handler, { once: true });
      });
    });
  } catch {
    return Promise.resolve();
  }
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

  const printStickerHtml = async ({ qrDataUrl, passText, ssidText, netText }) => {
    const w = window.open("", "_blank");

    const logo = "/logo-red7-dark.png";
    const wifiIcon = "/wifi-footer.svg";

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Etiqueta</title>
    <style>
      @page { size: 30mm 40mm; margin: 0; }
      html, body { width: 30mm; height: 40mm; margin: 0; padding: 0; overflow: hidden; }
      body { background: #fff; font-family: Arial, Helvetica, sans-serif; color: #000; }
      .sticker {
        width: 30mm;
        height: 40mm;
        box-sizing: border-box;
        padding: 1mm 1mm 0.8mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        text-align: center;
      }
      .logo {
        width: 24mm;
        height: auto;
        margin: 0.8mm 0 0.8mm;
      }
      .qr {
        width: 26mm;
        height: 26mm;
        object-fit: contain;
        margin: 0 0 1mm;
      }
      .pass {
        font-weight: 900;
        font-size: 5.2mm;
        line-height: 1.0;
        margin: 0 0 0.6mm;
        width: 28mm;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ssid {
        font-weight: 800;
        font-size: 3.6mm;
        line-height: 1.0;
        margin: 0 0 0.4mm;
        width: 28mm;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .net {
        font-weight: 900;
        font-size: 5.0mm;
        line-height: 1.0;
        margin: 0;
      }
      .spacer { flex: 1; }
      .wifi {
        width: 7mm;
        height: auto;
        margin: 0.6mm 0 0;
        opacity: 0.75;
      }
    </style>
  </head>
  <body>
    <div class="sticker">
      <img class="logo" src="${logo}" alt="" />
      <img class="qr" src="${qrDataUrl}" alt="QR" />
      <div class="pass">${passText}</div>
      <div class="ssid">${ssidText}</div>
      <div class="net">${netText}</div>
      <div class="spacer"></div>
      <img class="wifi" src="${wifiIcon}" alt="" />
    </div>
    <script>
      (function(){
        function allDone(){
          var imgs = Array.prototype.slice.call(document.images || []);
          return imgs.every(function(img){ return img.complete; });
        }
        function go(){
          try { window.focus(); } catch(e) {}
          setTimeout(function(){
            try { window.print(); } catch(e) {}
            setTimeout(function(){ try { window.close(); } catch(e) {} }, 250);
          }, 60);
        }
        if (allDone()) return go();
        window.addEventListener('load', function(){ setTimeout(go, 30); }, { once: true });
        setTimeout(go, 700);
      })();
    </script>
  </body>
</html>`;

    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      try {
        await waitForAllImages(w.document);
      } catch {
        // ignore
      }
      return;
    }

    // popup blocked: print via hidden iframe
    const iframe = document.createElement("iframe");
    iframe.style.position = "absolute";
    iframe.style.left = "-9999px";
    iframe.style.top = "0";
    document.body.appendChild(iframe);
    const idoc = iframe.contentWindow.document;
    idoc.open();
    idoc.write(html);
    idoc.close();

    await waitForAllImages(idoc);
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // ignore
      }
    }, 800);
  };

  const handlePrintOne = (index) => {
    setPrintIndex(index);
    setTimeout(async () => {
      const qrDataUrl = capturePrintCanvasPng();
      const item = qrs[index] || null;
      const passText = item ? (item.isOpen ? "OPEN" : String(item.password || "")) : "";
      const ssidText = item ? String(item.ssid || "") : "";
      const netText = item ? String(item.networkType || "") : "";

      if (!qrDataUrl) {
        setTimeout(() => window.print(), 120);
        return;
      }
      await printStickerHtml({ qrDataUrl, passText, ssidText, netText });
    }, 160);
  };

  const handleDownload = (index) => {
    setPrintIndex(index);
    setTimeout(() => {
      const data = capturePrintCanvasPng();
      if (!data) return;
      const a = document.createElement("a");
      a.href = data;
      a.download = `${safeFilename(qrs[index]?.ssid)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, 160);
  };

  const handlePrintRedQr = () => {
    const src = "/redqr.png";
    const img = new Image();
    img.onload = () => {
      const w = window.open("", "_blank");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>QR</title>
        <style>@page{size:50mm 30mm;margin:0}html,body{height:30mm;width:50mm;margin:0;padding:0;overflow:hidden}
        img{display:block;margin:0;width:50mm;height:30mm;object-fit:cover}
        </style></head><body>
        <img src="${src}" onload="setTimeout(function(){window.print();window.close();},160)" />
        </body></html>`;
      if (w) {
        w.document.open();
        w.document.write(html);
        w.document.close();
        return;
      }
      try {
        const iframe = document.createElement("iframe");
        iframe.style.position = "absolute";
        iframe.style.left = "-9999px";
        iframe.style.top = "0";
        document.body.appendChild(iframe);
        const idoc = iframe.contentWindow.document;
        idoc.open();
        idoc.write(html);
        idoc.close();
        iframe.contentWindow.focus();
        setTimeout(() => {
          try {
            iframe.contentWindow.print();
          } catch {}
          setTimeout(() => {
            try {
              document.body.removeChild(iframe);
            } catch {}
          }, 500);
        }, 200);
      } catch {
        setTimeout(() => window.print(), 120);
      }
    };
    img.src = src;
  };

  useEffect(() => {
    const onAfterPrint = () => setPrintIndex(null);
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

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
              {qrs.length > 0 && (
                <button
                  type="button"
                  onClick={() => handlePrintOne(qrs.length - 1)}
                  className="btn btn-primary"
                >
                  Imprimir última
                </button>
              )}
              <button
                type="button"
                onClick={handlePrintRedQr}
                className="btn btn-primary"
                style={{ marginLeft: 8 }}
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
                      <button type="button" className="btn btn-primary" onClick={() => handlePrintOne(i)}>
                        Imprimir
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => handleDownload(i)} style={{ marginLeft: 8 }}>
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
