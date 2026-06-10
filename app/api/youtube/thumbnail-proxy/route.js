import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch image from YouTube" }, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*", // Permitir acceso desde el frontend
        "Cache-Control": "public, max-age=86400", // Cache por 24 horas
      },
    });
  } catch (error) {
    console.error("[Thumbnail Proxy Error]:", error);
    return NextResponse.json({ error: "Error fetching image from proxy" }, { status: 500 });
  }
}
