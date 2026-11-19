import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, FileCode2, LoaderCircle, X } from 'lucide-react';
import type { FileRow } from './chat-transcript';

function downloadFile(file: FileRow) {
  const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ChatFiles({ files }: { files: FileRow[] }) {
  const [selected, setSelected] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const file = files.find(item => item.name === selected);
  useEffect(() => {
    if (file && !dialog.current?.open) dialog.current?.showModal();
  }, [file]);
  if (!files.length) return null;
  return <div className="chat-files" aria-label="本轮脚本文件">
    <div className="chat-file-list" aria-live="polite">
      {files.map(item => <button type="button" className="chat-file-row" key={item.name}
        onClick={() => setSelected(item.name)} aria-haspopup="dialog">
        {item.state === 'running' ? <LoaderCircle className="spinning" size={16}/> : <FileCode2 size={16}/>}
        <span>{item.state === 'running' ? '正在编辑' : '已编辑'}</span>
        <strong title={item.name}>{item.name}</strong>
        <span className="chat-file-count added">+{item.added}</span>
        <span className="chat-file-count removed">−{item.removed}</span>
        <ChevronRight size={15} aria-hidden="true"/>
      </button>)}
    </div>
    {file && <dialog ref={dialog} className="chat-file-dialog" aria-label={file.name}
      onClose={() => setSelected('')}>
      <header><FileCode2 size={19}/><h2>{file.name}</h2>
        <button type="button" className="chat-file-download" disabled={file.state === 'running'} onClick={() => downloadFile(file)}>
          <Download size={15}/>下载
        </button>
        <button type="button" className="icon-button" aria-label="关闭文件预览" autoFocus onClick={() => dialog.current?.close()}><X size={18}/></button>
      </header>
      <pre tabIndex={0} aria-label="文件内容"><code>{file.content}</code></pre>
    </dialog>}
  </div>;
}
