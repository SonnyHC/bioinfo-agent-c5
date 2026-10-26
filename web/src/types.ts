export type ChartKind = 'box' | 'violin' | 'scatter' | 'histogram' | 'bar' | 'heatmap';
export type DataRow = Record<string, string | number | null>;

export interface Dataset {
  id: string;
  name: string;
  rows: number;
  columns: { name: string; type: 'number' | 'string'; missing: number }[];
  preview: DataRow[];
  warnings: string[];
  sha256: string;
  createdAt: string;
}

export interface PlotConfig {
  chart: ChartKind;
  layout: 'long' | 'wide';
  x: string;
  y: string;
  group: string;
  valueColumns: string[];
  missing: 'error' | 'drop';
  title: string;
  xLabel: string;
  yLabel: string;
}

export interface Plan extends Partial<PlotConfig> {
  id: string;
  datasetId: string;
  chart: ChartKind;
  status: 'draft' | 'approved';
  preview: DataRow[];
  outputColumns: string[];
  inputRows: number;
  outputRows: number;
  droppedRows: number;
  steps: string[];
  warnings: string[];
  createdAt: string;
}

export interface Run {
  id: string;
  planId: string;
  datasetId: string;
  status: 'completed' | 'failed';
  createdAt: string;
  artifacts: { name: string; url: string }[];
  summary: { rows: number; groups?: number };
  error?: string;
}

export interface ServiceStatus {
  version: string;
  pythonReady: boolean;
  harness: { url: string; status: string };
  mode: 'local';
  maxUploadMB: number;
}
