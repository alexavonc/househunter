import { useState, useRef } from 'react';

interface Props {
  onUpload: (file: File, password: string) => Promise<void>;
  onClose: () => void;
}

export default function UploadPanel({ onUpload, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const result = await onUpload(file, password);
      void result;
      setMessage({ text: `Upload successful`, ok: true });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setMessage({ text: (err as Error).message, ok: false });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '20px 24px',
      marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Upload Shortlist JSON</h2>
        <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onClose}>✕</button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Upload password"
            required
            style={{ width: 180 }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>JSON File</label>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        <button
          className="btn-primary"
          type="submit"
          disabled={uploading || !file}
          style={{ height: 34 }}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {message && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          borderRadius: 6,
          fontSize: 13,
          background: message.ok ? 'var(--green-light)' : 'var(--red-light)',
          color: message.ok ? 'var(--green)' : 'var(--red)',
        }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
