import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";

export async function uploadProfilePhoto(
  uid: string,
  uri: string,
  mimeType = "image/jpeg",
): Promise<string> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const path = `users/${uid}/photo.${ext}`;
  const objectRef = ref(storage, path);

  const response = await fetch(uri);
  const blob = await response.blob();

  await uploadBytes(objectRef, blob, {
    contentType: mimeType || "image/jpeg",
  });
  return getDownloadURL(objectRef);
}
