
import Busboy from "busboy";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST required" });
  }

  const key = process.env.REMOVE_BG_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "REMOVE_BG_API_KEY is not configured on the website server."
    });
  }

  try {
    const bb = Busboy({ headers: req.headers });
    const chunks = [];
    let filename = "photo.png";
    let mime = "image/png";

    const finished = new Promise((resolve, reject) => {
      bb.on("file", (_name, file, info) => {
        filename = info.filename || filename;
        mime = info.mimeType || mime;
        file.on("data", chunk => chunks.push(chunk));
        file.on("error", reject);
      });
      bb.on("finish", resolve);
      bb.on("error", reject);
    });

    req.pipe(bb);
    await finished;

    const image = Buffer.concat(chunks);
    if (!image.length) {
      return res.status(400).json({ error: "image_file is required" });
    }

    const form = new FormData();
    form.append(
      "image_file",
      new Blob([image], { type: mime }),
      filename
    );
    form.append("size", "auto");

    const upstream = await fetch(
      "https://api.remove.bg/v1.0/removebg",
      {
        method: "POST",
        headers: { "X-Api-Key": key },
        body: form
      }
    );

    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/octet-stream"
    );
    return res.send(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Remove.bg proxy error: " + error.message
    });
  }
}
