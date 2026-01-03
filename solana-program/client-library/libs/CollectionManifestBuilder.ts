// client-library/libs/CollectionManifestBuilder.ts

/**
 * CollectionManifestBuilder - Utility for creating and managing collection manifests
 * 
 * Provides a fluent API for building collection manifests that will be stored on IPFS.
 * The manifest CID is hashed (SHA-256) and stored on-chain to keep content addresses private.
 */

import { createHash } from "crypto";
import {
  CollectionManifest,
  VideoMetadata,
  CreatorMetadata,
  VideoTechnicalSpecs,
  VideoResolution,
  VRFormat,
  VRStereoMode,
  ContentRating,
} from "./types";

/** Current schema version */
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * Builder for creating collection manifests
 */
export class CollectionManifestBuilder {
  private manifest: Partial<CollectionManifest> = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    videos: [],
    created_at: new Date().toISOString(),
  };

  constructor(collectionId: string, name: string) {
    this.manifest.collection_id = collectionId;
    this.manifest.name = name;
  }

  /**
   * Set collection description
   */
  setDescription(description: string): this {
    this.manifest.description = description;
    return this;
  }

  /**
   * Set creator metadata
   */
  setCreator(creator: CreatorMetadata): this {
    this.manifest.creator = creator;
    return this;
  }

  /**
   * Set content rating
   */
  setContentRating(rating: ContentRating): this {
    this.manifest.content_rating = rating;
    return this;
  }

  /**
   * Add collection-level tags
   */
  setTags(tags: string[]): this {
    this.manifest.tags = tags;
    return this;
  }

  /**
   * Set cover image CID
   */
  setCoverImage(cid: string): this {
    this.manifest.cover_image_cid = cid;
    return this;
  }

  /**
   * Set preview video CID (accessible without purchase)
   */
  setPreviewVideo(cid: string): this {
    this.manifest.preview_cid = cid;
    return this;
  }

  /**
   * Add a video to the collection
   */
  addVideo(video: VideoMetadata): this {
    if (!this.manifest.videos) {
      this.manifest.videos = [];
    }
    this.manifest.videos.push(video);
    return this;
  }

  /**
   * Add multiple videos to the collection
   */
  addVideos(videos: VideoMetadata[]): this {
    if (!this.manifest.videos) {
      this.manifest.videos = [];
    }
    this.manifest.videos.push(...videos);
    return this;
  }

  /**
   * Set custom metadata
   */
  setCustomMetadata(metadata: Record<string, any>): this {
    this.manifest.custom_metadata = metadata;
    return this;
  }

  /**
   * Build and validate the manifest
   */
  build(): CollectionManifest {
    // Validate required fields
    if (!this.manifest.collection_id) {
      throw new Error("collection_id is required");
    }
    if (!this.manifest.name) {
      throw new Error("name is required");
    }
    if (!this.manifest.creator) {
      throw new Error("creator metadata is required");
    }
    if (!this.manifest.content_rating) {
      throw new Error("content_rating is required");
    }
    if (!this.manifest.videos || this.manifest.videos.length === 0) {
      throw new Error("At least one video is required");
    }

    // Calculate aggregate statistics
    const totalDuration = this.manifest.videos.reduce(
      (sum, v) => sum + v.duration_seconds,
      0
    );

    const finalManifest: CollectionManifest = {
      schema_version: this.manifest.schema_version!,
      collection_id: this.manifest.collection_id,
      name: this.manifest.name,
      description: this.manifest.description,
      creator: this.manifest.creator,
      created_at: this.manifest.created_at!,
      updated_at: this.manifest.updated_at,
      total_videos: this.manifest.videos.length,
      total_duration_seconds: totalDuration,
      videos: this.manifest.videos,
      tags: this.manifest.tags,
      cover_image_cid: this.manifest.cover_image_cid,
      preview_cid: this.manifest.preview_cid,
      content_rating: this.manifest.content_rating,
      custom_metadata: this.manifest.custom_metadata,
    };

    return finalManifest;
  }

  /**
   * Build manifest and return as JSON string
   */
  buildJSON(pretty: boolean = false): string {
    const manifest = this.build();
    return JSON.stringify(manifest, null, pretty ? 2 : undefined);
  }

  /**
   * Build manifest and calculate SHA-256 hash (for on-chain storage)
   */
  buildWithHash(): { manifest: CollectionManifest; hash: Uint8Array; hashHex: string } {
    const manifest = this.build();
    const manifestJSON = JSON.stringify(manifest);
    const hash = createHash("sha256").update(manifestJSON).digest();

    return {
      manifest,
      hash: new Uint8Array(hash),
      hashHex: hash.toString("hex"),
    };
  }
}

/**
 * Builder for creating video metadata
 */
export class VideoMetadataBuilder {
  private video: Partial<VideoMetadata> = {
    uploaded_at: new Date().toISOString(),
  };

  constructor(videoId: string, title: string, cid: string) {
    this.video.video_id = videoId;
    this.video.title = title;
    this.video.cid = cid;
  }

  /**
   * Set description
   */
  setDescription(description: string): this {
    this.video.description = description;
    return this;
  }

  /**
   * Set duration in seconds
   */
  setDuration(seconds: number): this {
    this.video.duration_seconds = seconds;
    return this;
  }

  /**
   * Set recorded timestamp
   */
  setRecordedAt(date: Date | string): this {
    this.video.recorded_at = typeof date === "string" ? date : date.toISOString();
    return this;
  }

  /**
   * Set performer username
   */
  setPerformer(username: string): this {
    this.video.performer_username = username;
    return this;
  }

  /**
   * Add additional performers
   */
  setAdditionalPerformers(usernames: string[]): this {
    this.video.additional_performers = usernames;
    return this;
  }

  /**
   * Set technical specifications
   */
  setTechnicalSpecs(specs: VideoTechnicalSpecs): this {
    this.video.technical_specs = specs;
    return this;
  }

  /**
   * Set thumbnail CID
   */
  setThumbnail(cid: string): this {
    this.video.thumbnail_cid = cid;
    return this;
  }

  /**
   * Set preview clip CID
   */
  setPreviewClip(cid: string): this {
    this.video.preview_clip_cid = cid;
    return this;
  }

  /**
   * Set tags
   */
  setTags(tags: string[]): this {
    this.video.tags = tags;
    return this;
  }

  /**
   * Set content warnings
   */
  setContentWarnings(warnings: string[]): this {
    this.video.content_warnings = warnings;
    return this;
  }

  /**
   * Set file size
   */
  setFileSize(bytes: number): this {
    this.video.file_size_bytes = bytes;
    return this;
  }

  /**
   * Set file format
   */
  setFileFormat(format: string): this {
    this.video.file_format = format;
    return this;
  }

  /**
   * Set custom metadata
   */
  setCustomMetadata(metadata: Record<string, any>): this {
    this.video.custom_metadata = metadata;
    return this;
  }

  /**
   * Build and validate the video metadata
   */
  build(): VideoMetadata {
    // Validate required fields
    if (!this.video.video_id) {
      throw new Error("video_id is required");
    }
    if (!this.video.title) {
      throw new Error("title is required");
    }
    if (!this.video.cid) {
      throw new Error("cid is required");
    }
    if (!this.video.duration_seconds) {
      throw new Error("duration_seconds is required");
    }
    if (!this.video.recorded_at) {
      throw new Error("recorded_at is required");
    }
    if (!this.video.performer_username) {
      throw new Error("performer_username is required");
    }
    if (!this.video.technical_specs) {
      throw new Error("technical_specs is required");
    }

    return this.video as VideoMetadata;
  }
}

/**
 * Helper function to create technical specs for standard video
 */
export function createStandardVideoSpecs(
  resolution: VideoResolution,
  isVR: boolean = false
): VideoTechnicalSpecs {
  return {
    resolution,
    is_vr: isVR,
  };
}

/**
 * Helper function to create technical specs for VR video
 */
export function createVRVideoSpecs(
  resolution: VideoResolution,
  format: VRFormat,
  stereoMode: VRStereoMode,
  fps?: number
): VideoTechnicalSpecs {
  return {
    resolution,
    fps,
    is_vr: true,
    vr_format: format,
    vr_stereo_mode: stereoMode,
  };
}

/**
 * Validate a collection manifest
 */
export function validateCollectionManifest(
  manifest: any
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check schema version
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `Invalid schema version: ${manifest.schema_version} (expected ${MANIFEST_SCHEMA_VERSION})`
    );
  }

  // Check required fields
  if (!manifest.collection_id) errors.push("Missing collection_id");
  if (!manifest.name) errors.push("Missing name");
  if (!manifest.creator) errors.push("Missing creator");
  if (!manifest.content_rating) errors.push("Missing content_rating");
  if (!manifest.created_at) errors.push("Missing created_at");
  if (!manifest.videos || !Array.isArray(manifest.videos)) {
    errors.push("Missing or invalid videos array");
  } else if (manifest.videos.length === 0) {
    errors.push("Videos array is empty");
  }

  // Validate creator
  if (manifest.creator && !manifest.creator.username) {
    errors.push("Creator missing username");
  }

  // Validate each video
  if (manifest.videos && Array.isArray(manifest.videos)) {
    manifest.videos.forEach((video: any, index: number) => {
      const prefix = `Video ${index}:`;
      if (!video.video_id) errors.push(`${prefix} Missing video_id`);
      if (!video.title) errors.push(`${prefix} Missing title`);
      if (!video.cid) errors.push(`${prefix} Missing cid`);
      if (!video.duration_seconds) errors.push(`${prefix} Missing duration_seconds`);
      if (!video.recorded_at) errors.push(`${prefix} Missing recorded_at`);
      if (!video.performer_username) errors.push(`${prefix} Missing performer_username`);
      if (!video.technical_specs) {
        errors.push(`${prefix} Missing technical_specs`);
      } else {
        if (!video.technical_specs.resolution) {
          errors.push(`${prefix} Missing technical_specs.resolution`);
        }
        if (video.technical_specs.is_vr === undefined) {
          errors.push(`${prefix} Missing technical_specs.is_vr`);
        }
      }
    });
  }

  // Validate aggregate stats match
  if (manifest.videos && Array.isArray(manifest.videos)) {
    if (manifest.total_videos !== manifest.videos.length) {
      errors.push(
        `total_videos (${manifest.total_videos}) doesn't match videos array length (${manifest.videos.length})`
      );
    }

    const calculatedDuration = manifest.videos.reduce(
      (sum: number, v: any) => sum + (v.duration_seconds || 0),
      0
    );
    if (manifest.total_duration_seconds !== calculatedDuration) {
      errors.push(
        `total_duration_seconds (${manifest.total_duration_seconds}) doesn't match sum of video durations (${calculatedDuration})`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parse a collection manifest from JSON
 */
export function parseCollectionManifest(json: string): CollectionManifest {
  const manifest = JSON.parse(json);
  const validation = validateCollectionManifest(manifest);

  if (!validation.valid) {
    throw new Error(
      `Invalid collection manifest:\n${validation.errors.join("\n")}`
    );
  }

  return manifest as CollectionManifest;
}

/**
 * Calculate hash of a collection manifest (for on-chain storage)
 */
export function hashCollectionManifest(manifest: CollectionManifest): Uint8Array {
  const manifestJSON = JSON.stringify(manifest);
  const hash = createHash("sha256").update(manifestJSON).digest();
  return new Uint8Array(hash);
}

/**
 * Verify that a manifest matches an expected hash
 */
export function verifyManifestHash(
  manifest: CollectionManifest,
  expectedHash: Uint8Array
): boolean {
  const computedHash = hashCollectionManifest(manifest);

  if (computedHash.length !== expectedHash.length) {
    return false;
  }

  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < computedHash.length; i++) {
    mismatch |= computedHash[i] ^ expectedHash[i];
  }

  return mismatch === 0;
}

