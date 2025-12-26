export const metadata = {
  title: "MEXC Futures DASH",
  description: "MEXC Futures TURN_TOP30 Dashboard"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#fafafa"
        }}
      >
        {children}
      </body>
    </html>
  );
}
