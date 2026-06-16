import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import path from "path";
import fs from "fs";

export async function GET(request, { params }) {
  try {
    const { filename } = await params;
    if (!filename) {
      return new Response("Not Found", { status: 404 });
    }

    const safeFilename = path.basename(filename);

    // Buscar el logotipo en la base de datos
    let logo = await prisma.programLogo.findUnique({
      where: { name: safeFilename }
    });

    // Fallback: si no está en la base de datos, comprobar si existe en los logos estáticos iniciales
    if (!logo) {
      const STATIC_LOGOS_DIR = path.join(process.cwd(), "public", "static_program_logos");
      const staticFilePath = path.join(STATIC_LOGOS_DIR, safeFilename);
      if (fs.existsSync(staticFilePath)) {
        try {
          const buffer = fs.readFileSync(staticFilePath);
          const base64Content = buffer.toString("base64");
          
          // Guardar en la base de datos para que esté disponible de forma dinámica
          logo = await prisma.programLogo.upsert({
            where: { name: safeFilename },
            update: { base64: base64Content },
            create: { name: safeFilename, base64: base64Content }
          });
          console.log(`[Serve Logo API] Auto-seeded logo ${safeFilename} from static folder to DB`);
        } catch (fsErr) {
          console.error(`[Serve Logo API] Failed to auto-seed logo ${safeFilename} from disk:`, fsErr);
        }
      }
    }

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

