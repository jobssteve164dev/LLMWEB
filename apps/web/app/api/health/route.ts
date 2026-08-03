export function GET() {
  return Response.json({ service: "llmweb-web", status: "healthy" });
}
