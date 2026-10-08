import React from 'react';
import { num } from '../utils/money';
import { Button, Image, Space, Spin, Typography, message } from 'antd';
import { DeleteOutlined, FilePdfOutlined, PlusOutlined } from '@ant-design/icons';
import { Popconfirm } from './noConfirm';
import { api } from '../api/client';

type Attachment = {
  id: number;
  filename: string;
  content_type: string | null;
  bytes: number | null;
  url: string;
};

type Props = {
  docType: string;
  docId?: number | null;
  title?: string;
};

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

const sizeText = (n: number | null) => {
  if (!n) return '';
  return n >= 1024 * 1024
    ? `${num(n / (1024 * 1024), { maximumFractionDigits: 1 })} م.ب`
    : `${num(Math.round(n / 1024))} ك.ب`;
};

const newUuid = () => {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID() as string;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

function Attachments({ docType, docId, title = 'المرفقات' }: Props) {
  const [rows, setRows] = React.useState<Attachment[]>([]);
  const [urls, setUrls] = React.useState<Record<number, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const pickerRef = React.useRef<HTMLInputElement>(null);
  const urlsRef = React.useRef<Record<number, string>>({});

  const putUrl = (id: number, objectUrl: string) => {
    urlsRef.current[id] = objectUrl;
    setUrls({ ...urlsRef.current });
  };

  const dropUrl = (id: number) => {
    const u = urlsRef.current[id];
    if (u) URL.revokeObjectURL(u);
    delete urlsRef.current[id];
    setUrls({ ...urlsRef.current });
  };

  const fetchFile = React.useCallback(async (a: Attachment) => {
    if (urlsRef.current[a.id]) return;
    try {
      const res = await api.get(a.url, { responseType: 'blob' });
      putUrl(a.id, URL.createObjectURL(res.data as Blob));
    } catch {
    }
  }, []);

  const load = React.useCallback(async () => {
    if (!docId) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/documents/${docType}/${docId}/attachments`);
      const list: Attachment[] = Array.isArray(res.data) ? res.data : [];
      setRows(list);
      list.forEach((a) => { void fetchFile(a); });
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [docType, docId, fetchFile]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => () => {
    Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = {};
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !docId) return;
    setBusy(true);
    let added = 0;
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('client_uuid', newUuid());
        await api.post(`/api/v1/documents/${docType}/${docId}/attachments`, fd,
          { headers: { 'Content-Type': 'multipart/form-data' } });
        added += 1;
      } catch (err: any) {
        message.error(err?.response?.data?.detail?.message
          || `تعذر رفع «${f.name}»`);
      }
    }
    setBusy(false);
    if (added) {
      message.success(added > 1 ? `تم رفع ${added} صور` : 'تم رفع الصورة');
      void load();
    }
  };

  const remove = async (a: Attachment) => {
    try {
      await api.delete(`/api/v1/documents/attachments/${a.id}`);
      dropUrl(a.id);
      setRows((prev) => prev.filter((r) => r.id !== a.id));
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حذف المرفق');
    }
  };

  if (!docId) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <Space style={{ marginBottom: 8 }} align="center">
        <b>{title}</b>
        {rows.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            ({num(rows.length)})
          </Typography.Text>
        )}
        <Button size="small" icon={<PlusOutlined />} loading={busy}
          onClick={() => pickerRef.current?.click()}>
          أضف صورة
        </Button>
        {loading && <Spin size="small" />}
      </Space>
      <input ref={pickerRef} type="file" multiple accept={IMAGE_ACCEPT}
        style={{ display: 'none' }} onChange={onPick} />

      {rows.length === 0 && !loading && (
        <div style={{ color: '#555b65', fontSize: 14 }}>
          لا توجد صور على هذا المستند بعد.
        </div>
      )}

      <Image.PreviewGroup>
        <Space wrap size={8}>
          {rows.map((a) => {
            const src = urls[a.id];
            const isPdf = (a.content_type || '').includes('pdf');
            return (
              <div key={a.id} style={{
                position: 'relative', width: 96, height: 96, borderRadius: 8,
                border: '1px solid #e6efe3', overflow: 'hidden', background: '#fafafa',
              }}>
                {isPdf ? (
                  <a href={src} target="_blank" rel="noreferrer"
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', height: '100%', gap: 4, color: '#c0392b',
                    }}>
                    <FilePdfOutlined style={{ fontSize: 28 }} />
                    <span style={{ fontSize: 14, color: '#595959' }}>PDF</span>
                  </a>
                ) : src ? (
                  <Image src={src} alt={a.filename} width={96} height={96}
                    style={{ objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%',
                  }}><Spin size="small" /></div>
                )}
                <Popconfirm title="حذف المرفق؟" onConfirm={() => remove(a)}
                  okText="حذف" cancelText="إلغاء">
                  <Button size="small" danger type="text" icon={<DeleteOutlined />}
                    title={`${a.filename} ${sizeText(a.bytes)}`}
                    style={{
                      position: 'absolute', top: 0, insetInlineEnd: 0,
                      background: 'rgba(255,255,255,.85)',
                    }} />
                </Popconfirm>
              </div>
            );
          })}
        </Space>
      </Image.PreviewGroup>
    </div>
  );
}

class AttachmentsBoundary extends React.Component<
  { children: React.ReactNode }, { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('DocumentAttachments', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div style={{ marginTop: 16, color: '#555b65', fontSize: 14 }}>
          تعذّر عرض المرفقات.
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

export default function DocumentAttachments(props: Props) {
  return (
    <AttachmentsBoundary>
      <Attachments {...props} />
    </AttachmentsBoundary>
  );
}
