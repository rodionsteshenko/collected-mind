export type Concept = {
  id: number;
  slug: string;
  title: string;
  source: string;
  wikiUrl: string;
  oneLiner: string;
  aha: string;
  example: string;
  domain: string[];
  form: string;
  affect: string[];
  obscurity: number;
  surprise: number;
};

export type EdgeMap = Record<
  string, // src concept id (as string key)
  Partial<Record<EdgeKind, { id: number; w: number }[]>>
>;

export type EdgeKind =
  | "semantic_near"
  | "semantic_dedup"
  | "prerequisite_of"
  | "specializes"
  | "contrasts_with"
  | "example_of"
  | "same_phenomenon_different_frame";

export type Tags = {
  domain: [string, number][];
  form: [string, number][];
  affect: [string, number][];
  source: [string, number][];
  obscurity: [number, number][];
  total: number;
};

export type EmbeddingsMeta = {
  ids: number[];
  dim: number;
  model: string | null;
};

export type Signal = "knew" | "didnt" | "mind_blown";
