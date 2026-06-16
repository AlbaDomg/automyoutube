import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { verifyAppAuth } from "@/lib/auth";
import prisma from "@/lib/db";
import { getConfig, setConfig } from "@/lib/config";

const STATIC_LOGOS_DIR = path.join(process.cwd(), "public", "static_program_logos");

// Asegurar que el directorio estático existe (solo para desarrollo local/siembra)
try {
  if (!fs.existsSync(STATIC_LOGOS_DIR)) {
    fs.mkdirSync(STATIC_LOGOS_DIR, { recursive: true });
  }
} catch (err) {
  console.warn("[Program Logos API] Could not create logos directory on disk:", err.message);
}

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Comprobar si ya se han sembrado los logos predeterminados en la base de datos
    const isSeeded = await getConfig("PROGRAM_LOGOS_SEEDED");
    if (!isSeeded) {
      if (fs.existsSync(STATIC_LOGOS_DIR)) {
        const files = fs.readdirSync(STATIC_LOGOS_DIR);
        const imageExtensions = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
        const staticLogosToSeed = files.filter(file =>
          imageExtensions.includes(path.extname(file).toLowerCase())
        );

        for (const file of staticLogosToSeed) {
          const filePath = path.join(STATIC_LOGOS_DIR, file);
          try {
            const buffer = fs.readFileSync(filePath);
            const base64Content = buffer.toString("base64");
            await prisma.programLogo.upsert({
              where: { name: file },
              update: { base64: base64Content },
              create: { name: file, base64: base64Content }
            });
            console.log(`[Program Logos API] Seeded logo: ${file}`);
          } catch (seedErr) {
            console.error(`[Program Logos API] Failed to seed logo ${file}:`, seedErr);
          }
        }
      }
      await setConfig("PROGRAM_LOGOS_SEEDED", "true");
    }

    // Obtener todos los logotipos directamente de la base de datos (con playlistId)
    const dbLogos = await prisma.programLogo.findMany({
      select: { name: true, playlistId: true },
      orderBy: { createdAt: "asc" }
    });

    // Devolver tanto la lista de nombres (compatibilidad) como los objetos completos
    const logoNames = dbLogos.map(l => l.name);
    const logos = dbLogos.map(l => ({ name: l.name, playlistId: l.playlistId || null }));

    return NextResponse.json({ success: true, logos, logoNames });
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

    const playlistId = formData.get("playlistId") || null;

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name;
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, "_");

    // Guardar en la base de datos (con playlistId si se proporciona)
    const base64Content = buffer.toString("base64");
    await prisma.programLogo.upsert({
      where: { name: safeFilename },
      update: { base64: base64Content, playlistId: playlistId || null },
      create: { name: safeFilename, base64: base64Content, playlistId: playlistId || null }
    });

    // Opcionalmente guardar localmente en disco (si es posible)
    try {
      if (fs.existsSync(STATIC_LOGOS_DIR)) {
        const filePath = path.join(STATIC_LOGOS_DIR, safeFilename);
        fs.writeFileSync(filePath, buffer);
        console.log(`[Program Logos API] Saved new logo locally: ${safeFilename}`);
      }
    } catch (fsErr) {
      console.warn(`[Program Logos API] Could not save logo to local disk (expected on Vercel):`, fsErr.message);
    }

    return NextResponse.json({ success: true, filename: safeFilename, playlistId: playlistId || null });
  } catch (error) {
    console.error("[Program Logos API POST] Error uploading logo:", error);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}

// PATCH: actualizar solo el playlistId vinculado a un logo existente
export async function PATCH(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filename, playlistId } = await request.json();
    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 });
    }

    const safeFilename = path.basename(filename);

    await prisma.programLogo.update({
      where: { name: safeFilename },
      data: { playlistId: playlistId || null }
    });

    console.log(`[Program Logos API] Updated playlistId for logo "${safeFilename}": ${playlistId || "null"}`);
    return NextResponse.json({ success: true, filename: safeFilename, playlistId: playlistId || null });
  } catch (error) {
    console.error("[Program Logos API PATCH] Error updating logo playlistId:", error);
    return NextResponse.json({ error: "Failed to update logo" }, { status: 500 });
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

    // Opcionalmente eliminar del disco local (si existe)
    const filePath = path.join(STATIC_LOGOS_DIR, safeFilename);
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
