import './generar-qr.css';

export const metadata = {
  title: "QR Only",
  description: "Generador de QR WiFi (proyecto aislado)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        {children}
      </body>
    </html>
  );
}
