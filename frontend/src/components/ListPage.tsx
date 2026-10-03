import React from 'react';
import { Space } from 'antd';
import { numeralsLocale } from '../utils/money';

/**
 * **إطار صفحات الكشوف** — تصميم سجل المبيعات (طلب العميل ٢٠٢٦-١٠-٠١) في مكان واحد.
 *
 * طبقة رمادي واحدة ورا كروت بيضا: الترويسة (أيقونة · عنوان · شرايح بعدّادات · أزرار)،
 * الفلاتر في سطر، وجسم الكشف. الشكل كله في `index.css` تحت `.list-page`، فالصفحة
 * بتدّي المحتوى بس — مش بتعيد رسم الترويسة ولا الـCSS بتاعها.
 *
 * الجدول جوّه `children`: يدّي الـ`Table` الـclass `sl-table` عشان ياخد شكل الكشف
 * (ترويسة رمادي فاتح، سطور مضغوطة، ترقيم شمال). والإجماليات تحت الجدول بـ`sl-foot`.
 */
export interface ListTab<K extends string = string> {
  key: K;
  label: React.ReactNode;
  /** العدد في الشريحة — `null`/`undefined` = من غير عدّاد. */
  count?: number | null;
  /** لون النقطة قبل الاسم. */
  dot?: string;
}

/**
 * مربع رقم صغير في سطر الإجماليات فوق الكشف (`summary`) — العنوان رمادي صغير فوق والرقم تقيل.
 * `tone` بيلوّن الرقم: مبيعات أخضر، مرتجعات أحمر، تحصيلات أزرق، بونص برتقاني.
 */
export function ListStat({ label, value, tone, hint }: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: 'pos' | 'neg' | 'info' | 'warn' | 'strong';
  /** سطر باهت تحت الرقم — «(المعروض)» مثلاً. */
  hint?: React.ReactNode;
}) {
  return (
    <div className={`sl-stat${tone ? ` is-${tone}` : ''}`}>
      <div className="sl-stat-label">{label}</div>
      <div className="sl-stat-value">{value}</div>
      {hint ? <div className="sl-stat-hint">{hint}</div> : null}
    </div>
  );
}

export default function ListPage<K extends string = string>({
  icon, title, muted, subtitle, tabs, activeTab, onTabChange, actions, filters, summary, children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** جنب العنوان بلون باهت — «(سجل الفواتير والمرتجعات)». */
  muted?: React.ReactNode;
  subtitle?: React.ReactNode;
  tabs?: ListTab<K>[];
  activeTab?: K;
  onTabChange?: (key: K) => void;
  /** الأزرار على الشمال: الإنشاء، الطباعة، التصدير، الأعمدة. */
  actions?: React.ReactNode;
  /** عناصر سطر الفلاتر — كل عنصر بياخد عرض بالنسبة (`.sl-filters > *`). */
  filters?: React.ReactNode;
  /** سطر الإجماليات بين الترويسة والفلاتر — مربعات `ListStat` (طلب العميل ٢٠٢٦-١٠-٠٣). */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="list-page">
      <div className="sl-head">
        <div className="sl-title">
          {icon && <span className="sl-title-icon">{icon}</span>}
          <div>
            <div className="sl-title-main">
              {title}{muted && <> <span className="sl-title-muted">{muted}</span></>}
            </div>
            {subtitle && <div className="sl-subtitle">{subtitle}</div>}
          </div>
        </div>

        {tabs && tabs.length > 0 && (
          <div className="sl-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                className={`sl-tab${activeTab === t.key ? ' is-active' : ''}`}
                onClick={() => onTabChange?.(t.key)}
              >
                {t.dot && <span className="sl-dot" style={{ background: t.dot }} />}
                {t.label}
                {t.count != null && (
                  <span className="sl-count">{t.count.toLocaleString(numeralsLocale())}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {actions && <Space className="sl-actions" size={6} wrap>{actions}</Space>}
      </div>

      {summary && <div className="sl-summary">{summary}</div>}

      {filters && <div className="sl-filters">{filters}</div>}

      <div className="sl-body">{children}</div>
    </div>
  );
}
