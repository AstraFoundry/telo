/**
 * Story vocabulary: privacy, active period, and the post result.
 */
export type StoryPrivacy = "everyone" | "contacts" | "close-friends";

export type StoryActivePeriod = 21600 | 43200 | 86400 | 172800;

export interface PostStoryInput {
  readonly caption?: string;
  readonly privacy: StoryPrivacy;
  readonly activePeriod: StoryActivePeriod;
  readonly protectContent?: boolean;
  readonly durationSeconds?: number;
}

export interface PostedStoryDto {
  readonly id: string;
  readonly posterChatId: string;
  readonly postedAt: string;
  readonly expiresAt: string;
  readonly video: boolean;
}
