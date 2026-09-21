import React from 'react';
import { num } from '../utils/money';
import { Button, Image, Space, Spin, Typography, message } from 'antd';
import { DeleteOutlined, FilePdfOutlined, PlusOutlined } from '@ant-design/icons';
import { Popconfirm } from './noConfirm';
import { api } from '../api/client';

/**
 * مرفقات المستند — الصورة اللي بتتعلّق على الورقة، والضغط عليها بيفتحها كبيرة.
 *
 * مكوّن واحد لكل الشاشات: بياخد نوع المستند ورقمه وخلاص. الباك-إند جدول واحد بمفتاح
 * (نوع، رقم) — الشرح في `models/document_attachment.py` — فمافيش سبب يخلّي كل شاشة
 * تكتب نسختها من نفس الرفع والعرض والمسح.
 *
 * ---------------------------------------------------------------------------
 * **الصورة بتتجاب كـblob مش بـ`<img src>` على الـAPI.**
 *
 * التوكن بيتبعت في هيدر `Authorization` من الـinterceptor، و`<img>` مابيعدّيش هيدرات —
 * فالرابط المباشر كان هيرجع 401 وتبان صورة مكسورة. فالملف بيتجاب بـaxios (فبياخد
 * التوكن زي أي طلب) وبيتحوّل لـobject URL محلي، والـURL ده بيترجّع للمتصفح عند الخروج
 * عشان الذاكرة ماتفضلش ماسكة كل صورة اتفتحت.
 */

type Attachment = {
  id: number;
  filename: string;
  content_type: string | null;
  bytes: number | null;
  url: string;
};

type Props = {
  /** الاسم الموحّد للمستند: `stock_permit`، `sales_invoice`، `voucher`… */
  docType: string;
  /** رقم المستند — المسودّة مالهاش رقم، فالمكوّن بيختفي لحد ما تترحّل. */
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

/** معرّف عشوائي للرفعة — عشان إعادة المحاولة بعد قطع ماتكتبش نفس الصورة مرتين. */
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
  // الـobject URLs في ref كمان، لأن التنضيف عند الخروج بيقرا آخر قيمة — والـstate
  // في دالة التنضيف بتبقى صورة قديمة.
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
      // صورة واحدة ما جتش مابتوقّعش الباقي — بتفضل مكانها من غير معاينة.
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
      // **الخطأ هنا مايوقّفش الشاشة.** المرفقات إضافة على المستند — لو الـAPI رجع
      // خطأ (صلاحية، شبكة، سيرفر قديم) القسم بيفضل فاضي والفاتورة تحته شغّالة زي
      // ما هي. الشاشة دي فضيت قبل كده عند مدير فرع بسبب سطر واحد في `render`.
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [docType, docId, fetchFile]);

  React.useEffect(() => { void load(); }, [load]);

  // التنضيف عند الخروج بس — مش مع كل تحديث للقايمة، وإلا الصورة المعروضة بيتسحب
  // منها الرابط وهي على الشاشة.
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
      message.success(added > 1 ? `اترفعت ${added} صور` : 'اترفعت الصورة');
      void load();
    }
  };

  const remove = async (a: Attachment) => {
    try {
      await api.delete(`/api/v1/documents/attachments/${a.id}`);
      dropUrl(a.id);
      setRows((prev) => prev.filter((r) => r.id !== a.id));
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر مسح المرفق');
    }
  };

  if (!docId) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <Space style={{ marginBottom: 8 }} align="center">
        <b>{title}</b>
        {rows.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
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
        <div style={{ color: '#8c8c8c', fontSize: 12 }}>
          مافيش صور على المستند ده لسه.
        </div>
      )}

      {/* `Image.PreviewGroup` عشان التنقل بين الصور من جوّه المعاينة — اللي بيراجع
          إذن عليه تلات ورقات مايقفلش ويفتح تلات مرات. */}
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
                  // PDF مالوش معاينة جوّه الصفحة — بيتفتح في تبويب جديد من الـblob
                  // اللي اتجاب خلاص، فمافيش طلب تاني ولا مشكلة توكن.
                  <a href={src} target="_blank" rel="noreferrer"
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', height: '100%', gap: 4, color: '#c0392b',
                    }}>
                    <FilePdfOutlined style={{ fontSize: 28 }} />
                    <span style={{ fontSize: 10, color: '#595959' }}>PDF</span>
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
                <Popconfirm title="مسح المرفق؟" onConfirm={() => remove(a)}
                  okText="مسح" cancelText="إلغاء">
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

/**
 * حاجز أخطاء حوالين المكوّن.
 *
 * المرفقات إضافة على صفحة المستند، والصفحة دي هي شغل الناس. أي استثناء في `render`
 * بيفضّي الشجرة كلها في رياكت — يعني مرفق بصيغة غريبة كان ينفع يخلّي مدير الفرع يفتح
 * الإذن ويلاقي شاشة بيضا. الحاجز بيحوّل ده لسطر رمادي مكانه، والإذن تحته زي ما هو.
 */
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
        <div style={{ marginTop: 16, color: '#8c8c8c', fontSize: 12 }}>
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
