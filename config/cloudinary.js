import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

// Configure Cloudinary
import "dotenv/config";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} Cloudinary upload result
 */
export const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      resource_type: "auto",
      ...options,
    };

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      },
    );

    const readableStream = new Readable();
    readableStream.push(buffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);
  });
};

/**
 * Delete a file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @param {string} resourceType - Resource type (image, raw, video)
 * @returns {Promise<Object>}
 */
export const deleteFromCloudinary = async (
  publicId,
  resourceType = "image",
) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    return result;
  } catch (error) {
    console.error(`Failed to delete from Cloudinary: ${publicId}`, error);
    // Don't throw - we don't want deletion failures to break the app
    return { result: "error", error: error.message };
  }
};

/**
 * Extract public ID from Cloudinary URL
 * @param {string} url - Cloudinary URL
 * @returns {string|null} Public ID
 */
export const getPublicIdFromUrl = (url) => {
  if (!url || !url.includes("cloudinary.com")) {
    return null;
  }

  try {
    // Handle both image and raw URLs
    // Format: https://res.cloudinary.com/{cloud}/image/upload/{version}/{folder}/{publicId}.{ext}
    // or: https://res.cloudinary.com/{cloud}/raw/upload/{version}/{folder}/{publicId}.{ext}
    const regex =
      /\/(?:image|raw|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/;
    const match = url.match(regex);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

/**
 * Upload CV to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} userId - User ID for folder organization
 * @returns {Promise<Object>}
 */
export const uploadCV = async (buffer, filename, userId) => {
  const extension = filename.split(".").pop().toLowerCase();

  return uploadToCloudinary(buffer, {
    folder: `recruitment/cvs/${userId}`,
    resource_type: "raw",
    public_id: `cv_${Date.now()}`,
    format: extension,
    tags: ["cv", userId],
  });
};

/**
 * Upload profile image to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {string} userId - User ID for folder organization
 * @returns {Promise<Object>}
 */
export const uploadProfileImage = async (buffer, userId) => {
  return uploadToCloudinary(buffer, {
    folder: `recruitment/profiles/${userId}`,
    resource_type: "image",
    public_id: `profile_${Date.now()}`,
    transformation: [
      { width: 400, height: 400, crop: "fill", gravity: "face" },
      { quality: "auto:good" },
      { fetch_format: "auto" },
    ],
    tags: ["profile", userId],
  });
};

/**
 * Upload attachment to Cloudinary
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} folder - Target folder
 * @returns {Promise<Object>}
 */
export const uploadAttachment = async (
  buffer,
  filename,
  folder = "attachments",
) => {
  const extension = filename.split(".").pop().toLowerCase();
  const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(extension);

  return uploadToCloudinary(buffer, {
    folder: `recruitment/${folder}`,
    resource_type: isImage ? "image" : "raw",
    public_id: `attachment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    format: isImage ? undefined : extension,
    tags: ["attachment"],
  });
};

/**
 * Delete multiple files from Cloudinary
 * @param {string[]} urls - Array of Cloudinary URLs
 */
export const deleteMultipleFromCloudinary = async (urls) => {
  const deletePromises = urls.map(async (url) => {
    const publicId = getPublicIdFromUrl(url);
    if (publicId) {
      // Determine resource type from URL
      const resourceType = url.includes("/raw/") ? "raw" : "image";
      return deleteFromCloudinary(publicId, resourceType);
    }
  });

  await Promise.allSettled(deletePromises);
};

export default {
  uploadToCloudinary,
  deleteFromCloudinary,
  getPublicIdFromUrl,
  uploadCV,
  uploadProfileImage,
  uploadAttachment,
  deleteMultipleFromCloudinary,
};
