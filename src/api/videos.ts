import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken } from "../auth";
import { validateJWT } from "../auth";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { randomBytes } from "crypto";
import path from "path";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const maxFileSize = 1 << 30; // 1 GB
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const metaData = getVideo(cfg.db, videoId);
  if (!metaData || metaData.userID != userID) {
    throw new UserForbiddenError("not authorized to upload this video");
  }
  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("video file missing");
  }

  if (file.size > maxFileSize) {
    throw new BadRequestError("video file too large");
  }
  const mediaType = file.type;
  const fileType = mediaType.split("/")[1];

  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Unsupported video file type");
  }

  const data = await file.arrayBuffer();

  const identifier = randomBytes(32).toString("hex");

  const s3fileKey = `${identifier}.${fileType}`;
  const filePath = path.join(cfg.assetsRoot, "tmp", s3fileKey);
  Bun.write(filePath, data);

  // delete the temp file
  const temp_file = Bun.file(filePath);
  const s3File = cfg.s3Client.file(s3fileKey);
  await s3File.write(temp_file, {
    type: mediaType,
  });

  const url = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3fileKey}`;

  const newMetaData = { ...metaData, videoURL: url };
  updateVideo(cfg.db, newMetaData);
  await temp_file.delete();
  return respondWithJSON(200, newMetaData);
}
