import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { verifyAppAuth } from "@/lib/auth";

const LOGOS_DIR = path.join(process.cwd(), "public", "program_logos");

// Asegurar que el directorio existe
if (!fs.existsSync(LOGOS_DIR)) {
  fs.mkdirSync(LOGOS_DIR, { recursive: true });
}

export async function GET(request) {
  try {
    if (!(await verifyAppAuth(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const files = fs.readdirSync(LOGOS_DIR);
    // Filtrar solo archivos de imagen comunes
    const imageExtensions = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
    const logos = files.filter(file => 
      imageExtensions.includes(path.extname(file).toLowerCase())
    );
    return NextResponse.json({ success: true, logos });
  } catch (error) {
    console.error("[Program Logos API GET] Error reading directory:", error);
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
    const filePath = path.join(LOGOS_DIR, safeFilename);

    fs.writeFileSync(filePath, buffer);
    console.log(`[Program Logos API] Saved new logo: ${safeFilename}`);

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
    const filePath = path.join(LOGOS_DIR, safeFilename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Program Logos API] Deleted logo: ${safeFilename}`);
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("[Program Logos API DELETE] Error deleting logo:", error);
    return NextResponse.json({ error: "Failed to delete logo" }, { status: 500 });
  }
}
