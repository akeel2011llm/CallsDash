export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading">
      <div className="skeleton" style={{ blockSize: 36, inlineSize: "40%" }} />
      <div className="skeleton" style={{ blockSize: 96 }} />
      <div className="skeleton" style={{ blockSize: 220 }} />
    </div>
  );
}
