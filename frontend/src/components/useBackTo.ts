import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * «رجوع» بيرجّع **للمكان اللي جيت منه**، مش لمكان مكتوب في الكود.
 *
 * كارت العميل والمورد والصنف كان كل واحد فيهم زرار رجوعه مكتوب فيه وجهة ثابتة
 * (`navigate('/customers')`). والصفحات دي مابتتفتحش من كشفها وحده: اسم العميل جوّه
 * فاتورة البيع لينك بيفتح كشف حسابه — واللي بيدوس «رجوع» بعدها بيلاقي نفسه في
 * **كشف العملاء**، مش في الفاتورة اللي كان شغّال عليها. بيفقد السطر اللي كان
 * واقف عليه، وبيدوّر على الفاتورة من أول وجديد.
 *
 * ونفس القاعدة اللي اتحطّت للمستندات قبل كده (`useDocRoute`): الرجوع خطوة لورا في
 * التاريخ، مش قفزة لمكان.
 *
 * **والوجهة الثابتة بتفضل كخطة بديلة** — اللي فتح الرابط من برّه (لينك متبعوت،
 * أو تبويب جديد) مالوش تاريخ يرجع له، ولو ندهنا `navigate(-1)` هيخرج من النظام
 * كله. `history.state.idx` بيقول إحنا في أي خطوة: صفر يعني ده أول مدخل.
 */
export function useBackTo(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as any)?.idx;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
      return;
    }
    navigate(fallback);
  }, [navigate, fallback]);
}

export default useBackTo;
