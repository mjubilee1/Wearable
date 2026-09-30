import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";

export async function uploadProfilePhoto(
  uid: string,
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `users/${uid}/photo.${ext === "png" ? "png" : "jpg"}`;
  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, file, {
    contentType: file.type || "image/jpeg",
  });
  return getDownloadURL(objectRef);
}
