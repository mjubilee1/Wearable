/** Resize and compress a user-selected image before upload. Raw bytes never stay. */
export async function compressImageFile(
  file: File,
  maxEdge = 1280,
  quality = 0.72,
): Promise<{ mediaType: "image/jpeg"; dataBase64: string }> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a photo of the surroundings.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the photo.");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) throw new Error("Could not compress the photo.");
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]!);
    }
    return { mediaType: "image/jpeg", dataBase64: btoa(binary) };
  } finally {
    bitmap.close();
  }
}
