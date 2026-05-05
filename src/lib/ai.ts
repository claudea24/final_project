export type AnalysisItem = {
  id: string;
  name: string;
  scene: string;
  qualityScore: number;
  caption: string;
};

export type AnalysisResult = {
  items: AnalysisItem[];
  orderedIds: string[];
  source: "claude" | "heuristic";
  reason?: string;
};
