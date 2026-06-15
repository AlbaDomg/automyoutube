import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import path from "path";

export async function GET(request, { params }) {
  try {
    const { filename } = await params;
    if (!filename) {
      return new Response("Not Found", { status: 404 });
    }

    const safeFilename = path.basename(filename);

    // Buscar el logotipo en la base de datos
    const logo = await prisma.programLogo.findUnique({
      where: { name: safeFilename }
    });

    if (!logo) {
      return new Response("Not Found", { status: 404 });
    }

    const buffer = Buffer.from(logo.base64, "base64");

    const extension = path.extname(safeFilename).toLowerCase();
    let mimeType = "image/png";
    if (extension === ".jpg" || extension === ".jpeg") {
      mimeType = "image/jpeg";
    } else if (extension === ".svg") {
      mimeType = "image/svg+xml";
    } else if (extension === ".webp") {
      mimeType = "image/webp";
    }

    return new Response(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (error) {
    console.error("[Serve Logo API] Error serving logo:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
