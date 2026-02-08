import multer from "multer";
import path from "path";

// Use memory storage for Cloudinary uploads
const memoryStorage = multer.memoryStorage();

// File filter for CVs
const fileFilterCV = (req, file, cb) => {
  const allowed = [".pdf", ".doc", ".docx"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowed.includes(ext)) {
    return cb(new Error("Seulement PDF, DOC ou DOCX autorisés"));
  }
  cb(null, true);
};

// File filter for images
const fileFilterImage = (req, file, cb) => {
  const allowed = [".jpg", ".jpeg", ".png", ".webp"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowed.includes(ext)) {
    return cb(new Error("Seulement JPG, JPEG, PNG ou WEBP autorisés"));
  }
  cb(null, true);
};

// File filter for attachments (both images and documents)
const fileFilterAttachments = (req, file, cb) => {
  const allowed = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (!allowed.includes(ext)) {
    return cb(new Error("Type de fichier non autorisé"));
  }
  cb(null, true);
};

// CV upload middleware
export const uploadCV = multer({
  storage: memoryStorage,
  fileFilter: fileFilterCV,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Image upload middleware
export const uploadImage = multer({
  storage: memoryStorage,
  fileFilter: fileFilterImage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Attachments upload middleware
export const uploadAttachments = multer({
  storage: memoryStorage,
  fileFilter: fileFilterAttachments,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Error handler for multer
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ msg: "Fichier trop volumineux" });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ msg: "Trop de fichiers" });
    }
    return res.status(400).json({ msg: err.message });
  }
  if (err) {
    return res.status(400).json({ msg: err.message });
  }
  next();
};

export default { uploadCV, uploadImage, uploadAttachments, handleMulterError };
