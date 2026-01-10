import fs from "fs";

export default function setupFolders() {
  const folders = [
    "uploads",
    "uploads/cv",
    "uploads/images",
    "uploads/attachments",
    "uploads/documents",
  ];

  folders.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Dossier créé : ${dir}`);
    }
  });
}
