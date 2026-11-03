import { chartPreviews } from './chart-previews';
import type { ChartKind } from './types';
import './chart-preview.css';

export default function ChartPreview({kind}: {kind: ChartKind}) {
  const preview = chartPreviews[kind];
  return <span className={`chart-preview${preview ? '' : ' chart-preview-empty'}`}>
    {preview ? <img src={preview.url} alt={preview.alt} loading="lazy"/> : <span>附件未提供<br/>此图型</span>}
  </span>;
}
