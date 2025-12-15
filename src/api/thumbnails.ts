import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { buffer } from "stream/consumers";
import path from "path";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  // TODO: implement the upload here
  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  if (file.size > 1 << 20) {
    throw new BadRequestError("Thumbnail file too large");
  }

  const mediaType = file.type;
  const fileType = mediaType.split("/")[1];

  if (mediaType !== "image/png" && mediaType !== "image/jpeg") {
    throw new BadRequestError("Unsupported thumbnail file type");
  }

  const data = await file.arrayBuffer();

  const filePath = path.join(cfg.assetsRoot, `${videoId}.${fileType}`);
  Bun.write(filePath, data);

  const metaData = getVideo(cfg.db, videoId);
  if (!metaData || userID !== metaData.userID) {
    throw new UserForbiddenError(
      "User not authorized to upload thumbnail for this video"
    );
  }

  const thumbnail_url = `http://localhost:${cfg.port}/assets/${videoId}.${fileType}`;

  const newMetaData = { ...metaData, thumbnailURL: thumbnail_url };
  updateVideo(cfg.db, newMetaData);

  return respondWithJSON(200, newMetaData);
}
