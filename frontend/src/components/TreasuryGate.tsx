import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, message } from 'antd';
import { TabModal } from './TabModal';
import { api } from '../api/client';
import { money } from '../utils/money';

/**
 * بوباب الخزنة — آخر سؤال قبل ما المستند يتحفظ: **الفلوس دي رايحة فين، وجاية منين**.
 *
 * a5 بيدّي كل مندوب صندوقين — «صندوق أبيض السيارة (أ)» و«صندوق بولي السيارة (أ)» — والكاش
 * بيتفصل بالخط زي المديونية بالظبط. يعني «نوع الفاتورة» بيحدد حاجتين: المديونية اللي بتزيد،
 * والصندوق اللي الفلوس بتنزل فيه. الشاشة كانت بتسأل عن الأولانية بس، والتانية كانت بتتقرر
 * في السيرفر من غير ما اللي بيحفظ يشوفها.
 *
 * والبوباب ده **بيسأل ويمرّر الإجابة، وبس** — مافيش منطق حفظ ولا حساب جوّاه. اللي بيندهه
 * بيبعت المبلغ والاتجاه وخط المستند، وبياخد رقم الحساب اللي اتقال.
 *
 * ليه سؤال أصلاً وإحنا عارفين الخط؟ لأن **الاقتراح مش قرار**. الفاتورة اللي اتكتبت على خط
 * والفلوس اتحطّت في صندوق تاني حاجة بتحصل — المندوب سلّم المكتب، أو الكاش اتحصّل في الفرع.
 * فالبوباب بيقترح صندوق الخط، وبيسيبه مفتوح للتغيير.
 *
 * ثلاث قواعد مكتوبة في الأمر ٠٠٩، وكلها هنا:
 *
 * * **الاتجاه بيتقال بوضوح.** البيع ومردود الشرا بيضيفوا للخزنة؛ الشرا ومردود البيع بيخصموا
 *   منها. اللي بيحفظ لازم يشوف ده قبل ما يأكّد، مش بعدين في كشف الحساب.
 * * **رجوع موجود.** اللي فتح البوباب بالغلط مايتحبسش، والمستند مايتحفظش.
 * * **المستند اللي نقديه صفر مابيسألش.** كله آجل يعني مافيش فلوس بتتحرّك — وسؤال مالوش
 *   أثر مش سؤال.
 *
 * النمط من `WarehouseGate`: نفس `TabModal`، نفس `Select` بالبحث، ونفس Enter اللي بيأكّد.
 * النظام فيه أربع بوابات بنفس الشكل والكيبورد، ودي الخامسة بنفسهم — مش بشكل جديد.
 */

/** الاتجاه: `in` الفلوس داخلة الخزنة، `out` خارجة منها. */
export type CashDirection = 'in' | 'out';

export interface TreasuryChoice {
  value: number;
  label: string;
  /** خط الصندوق زي ما اسمه بيقول — «أبيض» / «بولي» / `null` لصندوق مالوش خط. */
  family: string | null;
}

/** عربية مجرّدة من اختلافات الهمزة والتاء المربوطة — «ابيض» و«أبيض» كلمة واحدة. */
const bare = (s: string) => (s || '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي');

/**
 * خط الصندوق من **اسمه هو**، مش من تخمين على مين صاحبه.
 *
 * الاسم في شجرة a5 بيقول الخط بالنص: «صندوق أبيض السيارة (أ)». و«تكنو» = «بولي» — سكربت
 * النقل بيوحّد الاسم، بس الحسابات القديمة اللي اتكتبت بالإيد ممكن تفضل بالاسم القديم،
 * فالاتنين بيتقروا هنا نفس القراءة.
 */
export function familyOfSafe(name: string): string | null {
  const k = bare(name);
  if (k.includes('ابيض')) return 'أبيض';
  if (k.includes('بولي') || k.includes('تكنو')) return 'بولي';
  return null;
}

/**
 * صناديق الشجرة — الحسابات اللي نوعها `treasury`.
 *
 * من `/accounts` مش من `/treasuries`: صناديق a5 الـ١٣ اتنقلت كحسابات خزينة في الشجرة
 * (`import_a5_treasuries`)، و`/treasuries` بترجّع سجلات `Treasury` بتاعتنا وبس — يعني
 * القايمة كانت هتطلع من غير الصناديق اللي السؤال كله عليها.
 *
 * الفشل بيرجّع قايمة فاضية، والفاضية معناها **مافيش بوباب** — اللي مالوش صلاحية يقرا
 * الشجرة يفضل بيحفظ زي ما هو. قفل الحفظ عشان قايمة مانزلتش أسوأ من سؤال مااتسألش.
 */
export function useTreasurySafes(enabled = true): [TreasuryChoice[], boolean] {
  const [rows, setRows] = useState<TreasuryChoice[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) { setRows([]); setFailed(false); return; }
    setFailed(false);
    let alive = true;
    // نفس عنوان `Invoices` بالظبط — الكاش في `api/client` بيتفهرس بالعنوان الكامل،
    // فالحرف الزيادة معناه طلبة تانية لنفس القايمة.
    api.get('/api/v1/cash-accounts')
      .then((res) => {
        if (!alive) return;
        setRows((res.data || []).map((t: any) => ({
          value: t.account_id,
          label: t.rep_name ? `${t.name || `#${t.account_id}`} — ${t.rep_name}`
                            : (t.name || `خزينة #${t.account_id}`),
          // الخط من العهدة المربوطة بالصندوق؛ والقراءة من الاسم فضلت كاحتياطي للصناديق
          // اللي مالهاش عهدة (المركز الرئيسي، البونص).
          family: t.family ?? familyOfSafe(t.name || ''),
        })));
      })
      .catch((e) => {
        if (!alive) return;
        setRows([]);
        setFailed(true);
        // eslint-disable-next-line no-console
        console.error('[TreasuryGate] قايمة الخزائن مانزلتش', e);
      });
    return () => { alive = false; };
  }, [enabled]);
  return [rows, failed];
}

export interface TreasuryGateProps {
  open: boolean;
  direction: CashDirection;
  amount: number;
  options: TreasuryChoice[];
  value: number | null;
  onChange: (v: number) => void;
  onOk: () => void;
  onCancel: () => void;
  /** اسم المستند زي ما الشاشة بتسمّيه — «فاتورة البيع»، «مردود المبيعات». */
  docLabel?: string;
  okText?: string;
  cancelText?: string;
}

export default function TreasuryGate({
  open, direction, amount, options, value, onChange, onOk, onCancel,
  docLabel, okText = 'احفظ', cancelText = 'رجوع',
}: TreasuryGateProps) {
  const chosenRef = useRef<number | null>(value);
  chosenRef.current = value;

  const inbound = direction === 'in';
  const tone = inbound ? '#6AB42D' : '#cf1322';
  const wash = inbound ? '#f6faf3' : '#fff1f0';

  return (
    <TabModal
      open={open}
      title={inbound ? 'الفلوس هتنزل في أنهي خزنة؟' : 'الفلوس هتتصرف من أنهي خزنة؟'}
      okText={okText}
      cancelText={cancelText}
      okButtonProps={{ disabled: value === null || value === undefined }}
      onCancel={onCancel}
      onOk={onOk}
      destroyOnHidden
    >
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
          if (chosenRef.current === null || chosenRef.current === undefined) return;
          e.preventDefault();
          onOk();
        }}
      >
        {/* الاتجاه أول حاجة العين تشوفها — «بيضيف» و«بيخصم» مش نفس الحركة، والفرق بينهم
            مايتقالش بعدين في كشف الحساب. */}
        <div style={{
          background: wash, border: `1px solid ${tone}33`, borderRadius: 6,
          padding: '10px 12px', marginBottom: 12, display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontWeight: 600 }}>
            {docLabel ? `${docLabel} — ` : ''}
            {inbound ? 'إضافة للخزنة' : 'خصم من الخزنة'}
          </span>
          <span style={{ color: tone, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {Math.abs(amount) > 0.004
              ? `${inbound ? '+' : '−'} ${money(amount)} ج.م`
              : 'كله آجل — مافيش نقدي دلوقتي'}
          </span>
        </div>

        <Select
          autoFocus
          style={{ width: '100%' }}
          size="large"
          showSearch
          optionFilterProp="label"
          placeholder="اختر الخزنة"
          value={value ?? undefined}
          onChange={(v) => { chosenRef.current = v as number; onChange(v as number); }}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
        />
        <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
          المقترح صندوق خط المستند — غيّره لو الفلوس اتحطّت في خزنة تانية.
        </div>
      </div>
    </TabModal>
  );
}

export interface TreasuryAsk {
  /** النقدي اللي بيتحرّك. صفر بيظهر برضه — بيتقال «كله آجل» بدل الرقم. */
  amount: number;
  direction: CashDirection;
  /** خط المستند — «أبيض» / «بولي». منه بييجي الاقتراح. */
  family?: string | null;
  docLabel?: string;
}

/**
 * الحارس اللي بينده البوباب ويستنى الرد.
 *
 * الاستعمال: بدل ما الشاشة تحفظ على طول، بتقول `ask({...}, (accountId) => save(accountId))`.
 * البوباب بيظهر، واللي بيحفظ بيختار، والدالة بتتنده بالاختيار. ولو مافيش سؤال أصلاً
 * (نقدي صفر، أو مافيش صناديق) بتتنده على طول بـ`null` — الحفظ مايتعطّلش.
 */
export function useTreasuryGate(enabled = true) {
  const [options, failed] = useTreasurySafes(enabled);
  const [req, setReq] = useState<(TreasuryAsk & { run: (id: number | null) => void }) | null>(null);
  const [value, setValue] = useState<number | null>(null);

  const suggested = useMemo(() => {
    if (!req) return null;
    if (req.family) {
      const hit = options.find((o) => o.family === req.family);
      return hit ? hit.value : null;
    }
    // مستند من غير خط: صندوق واحد يبقى مافيش اختيار، وأكتر من واحد يبقى قرار مش تخمين.
    return options.length === 1 ? options[0].value : null;
  }, [req, options]);

  /** ⚠️ `prev ?? ` مقصودة: قايمة وصلت متأخرة كانت بتمسح اللي المستخدم اختاره لسه. */
  useEffect(() => {
    if (!req || suggested === null) return;
    setValue((prev) => prev ?? suggested);
  }, [req, suggested]);

  const ask = useCallback((o: TreasuryAsk, run: (id: number | null) => void) => {
    if (!enabled) {
      run(null);
      return;
    }
    // البوباب بيظهر حتى والنقدي صفر — قرار صاحب النظام الصريح («سواء خصم وإضافة»)،
    // بعد ما كان بيتخطى المستند الآجل وباين له إن البوباب مش موجود أصلاً. والاختيار
    // مش كلام: بيتسجّل `cash_account_id` على المستند، فلو المستند اتعدّل بعدين
    // ونزل عليه نقدي، بينزل في الخزنة اللي اتقالت يوم ما اتكتب.
    // ⚠️ القايمة الفاضية **مش نفس** القايمة اللي مانزلتش.
    //
    // ده اللي خلّى البوباب ماظهرش خالص أول ما اتنشر: كان بيقرا شجرة الحسابات، ودي
    // صلاحية محاسبة مالهاش غير الأدمن والمحاسب — فمدير الفرع بياخد 403، القايمة تفضل
    // فاضية، والشرط ده يعدّي الحفظ **من غير ما يسأل ومن غير ما يقول إنه ماسألش**.
    // اللي بيحفظ فاكر إنه اختار، وهو ماتسألش أصلاً.
    if (failed) {
      message.error('قايمة الخزائن مانزلتش — الخزنة هتتحدد من السيرفر. جرّب تحدّث الصفحة.');
      run(null);
      return;
    }
    if (options.length === 0) {
      run(null);
      return;
    }
    setValue(null);
    setReq({ ...o, run });
  }, [enabled, options, failed]);

  const close = useCallback(() => { setReq(null); setValue(null); }, []);

  const gateProps: TreasuryGateProps = {
    open: req !== null,
    direction: req?.direction ?? 'in',
    amount: req?.amount ?? 0,
    docLabel: req?.docLabel,
    options,
    value,
    onChange: setValue,
    // الرجوع بيقفل وبس — المستند مايتحفظش، والسطور مكانها.
    onCancel: close,
    onOk: () => {
      const pending = req;
      const chosen = value;
      close();
      if (pending && chosen !== null) pending.run(chosen);
    },
  };

  return { ask, gateProps };
}
