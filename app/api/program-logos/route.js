import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { verifyAppAuth } from "@/lib/auth";
import prisma from "@/lib/db";

const LOGOS_DIR = path.join(process.cwd(), "public", "program_logos");

// Asegurar que el directorio existe (solo local)
try {
  if (!fs.existsSync(LOGOS_DIR)) {
    fs.mkdirSync(LOGOS_DIR, { recursive: true });
  }
} catch (err) {
  console.warn("[Program Logos API] Could not create logos directory on disk:", err.message);
}

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let staticLogos = [];
    if (fs.existsSync(LOGOS_DIR)) {
      const files = fs.readdirSync(LOGOS_DIR);
      // Filtrar solo archivos de imagen comunes
      const imageExtensions = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
      staticLogos = files.filter(file => 
        imageExtensions.includes(path.extname(file).toLowerCase())
      );
    }

    // Obtener logotipos desde la base de datos
    const dbLogos = await prisma.programLogo.findMany({
      select: { name: true }
    });
    const dbLogoNames = dbLogos.map(l => l.name);

    // Combinar y hacer únicos
    const uniqueLogos = Array.from(new Set([...staticLogos, ...dbLogoNames]));

    return NextResponse.json({ success: true, logos: uniqueLogos });
  } catch (error) {
    console.error("[Program Logos API GET] Error reading logos catalog:", error);
    return NextResponse.json({ error: "Failed to read logos catalog" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name;
    // Sanitizar el nombre de archivo para evitar vulnerabilidades de path traversal
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, "_");

    // Guardar en la base de datos
    const base64Content = buffer.toString("base64");
    await prisma.programLogo.upsert({
      where: { name: safeFilename },
      update: { base64: base64Content },
      create: { name: safeFilename, base64: base64Content }
    });

    // Opcionalmente guardar localmente en disco (si es posible)
    try {
      if (fs.existsSync(LOGOS_DIR)) {
        const filePath = path.join(LOGOS_DIR, safeFilename);
        fs.writeFileSync(filePath, buffer);
        console.log(`[Program Logos API] Saved new logo locally: ${safeFilename}`);
      }
    } catch (fsErr) {
      console.warn(`[Program Logos API] Could not save logo to local disk (expected on Vercel):`, fsErr.message);
    }

    return NextResponse.json({ success: true, filename: safeFilename });
  } catch (error) {
    console.error("[Program Logos API POST] Error uploading logo:", error);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filename } = await request.json();
    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }

    const safeFilename = path.basename(filename);

    // Eliminar de la base de datos
    try {
      await prisma.programLogo.deleteMany({
        where: { name: safeFilename }
      });
    } catch (dbErr) {
      console.error("[Program Logos API DELETE] DB delete error:", dbErr);
    }

    // Opcionalmente eliminar del disco local
    const filePath = path.join(LOGOS_DIR, safeFilename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[Program Logos API] Deleted logo locally: ${safeFilename}`);
      } catch (fsErr) {
        console.warn("[Program Logos API DELETE] Failed to delete from disk (expected on Vercel):", fsErr.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Program Logos API DELETE] Error deleting logo:", error);
    return NextResponse.json({ error: "Failed to delete logo" }, { status: 500 });
  }
}
