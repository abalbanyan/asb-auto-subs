export type AnimeMetaData = {
  anilistId?: number;
  episode: number;
  title: string;
};

export type SubtitlePatterns = {
  [title: string]: string;
};

export type DisabledSeries = {
  [title: string]: boolean;
};

export type Subs = {
  url: string;
  name: string;
  size: number;
  lastModified: string;
};

export type JimakuEntry = {
  id: number;
  anilist_id?: number;
  name?: string;
};

export type AnilistObject = {
  data?: {
    Media: {
      id: number;
    } | null;
  } | null;
  errors?: { message?: string; status?: number }[];
};
