// services/fileService.js
import fs from "fs/promises";
import path from "path";
import SystemSettings from "../models/SystemSettings.js";
import { uploadAttachment } from "../config/cloudinary.js";

export const saveFiles = async (files, folderName = "attachments") => {
  if (!files || files.length === 0) return [];

  // Récupérer le mode de stockage depuis les paramètres (par défaut: local_storage)
  const storageMode = await SystemSettings.getSetting(
    "storage_mode",
    "local_storage",
  );
  const savedPaths = [];

  if (storageMode === "cloudinary") {
    // Mode Cloudinary
    for (const file of files) {
      const result = await uploadAttachment(
        file.buffer,
        file.originalname,
        folderName,
      );
      savedPaths.push(result.secure_url);
    }
  } else {
    // Mode Local Storage
    const uploadDir = path.join(process.cwd(), "uploads", folderName);

    // Créer le dossier s'il n'existe pas
    await fs.mkdir(uploadDir, { recursive: true });

    for (const file of files) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      const filename = `doc-${uniqueSuffix}${ext}`;
      const filePath = path.join(uploadDir, filename);

      // Écrire le fichier sur le disque
      await fs.writeFile(filePath, file.buffer);

      // Retourner le chemin relatif pour y accéder via l'URL (ex: /uploads/documents/doc-123.pdf)
      savedPaths.push(`/uploads/${folderName}/${filename}`);
    }
  }

  return savedPaths;
};
