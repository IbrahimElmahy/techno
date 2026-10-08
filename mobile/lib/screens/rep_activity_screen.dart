import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/supervisor.dart';
import '../theme.dart';
import '../utils/format.dart';
import '../widgets/supervisor_widgets.dart';
import 'rep_document_screen.dart';

class RepActivityScreen extends StatefulWidget {
  const RepActivityScreen({super.key, required this.rep, required this.period});

  final SupRep rep;

  final SupPeriod period;

  @override
  State<RepActivityScreen> createState() => _RepActivityScreenState();
}

class _RepActivityScreenState extends State<RepActivityScreen> {
  late SupPeriod _period = widget.period;

  late SupStats? _stats = widget.rep.stats;
  bool _statsLoading = false;
  int _req = 0;

  Future<void> _loadStats() async {
    final my = ++_req;
    setState(() {
      _statsLoading = true;
      _stats = null;
    });
    SupStats? s;
    try {
      final j = await ApiClient.instance.supervisorOverview(_period.fromIso, _period.toIso);
      final o = SupOverview.fromJson(j);
      for (final r in o.reps) {
        if (r.id == widget.rep.id) s = r.stats;
      }
    } catch (_) {}
    if (!mounted || my != _req) return;
    setState(() {
      _stats = s;
      _statsLoading = false;
    });
  }

  void _setPeriod(SupPeriod p) {
    setState(() => _period = p);
    _loadStats();
  }

  @override
  Widget build(BuildContext context) {
    const kinds = ActivityKind.values;
    return DefaultTabController(
      length: kinds.length,
      child: Scaffold(
        appBar: AppBar(
          title: Column(
            children: [
              Text(widget.rep.fullName),
              const Text('حركة المندوب',
                  style: TextStyle(fontSize: 12, color: Colors.white70)),
            ],
          ),
        ),
        body: Column(
          children: [
            Container(
              color: Colors.white,
              padding: const EdgeInsets.only(top: 12, bottom: 10),
              child: Column(
                children: [
                  PeriodChips(period: _period, onChanged: _setPeriod),
                  const SizedBox(height: 10),
                  _summaryStrip(),
                ],
              ),
            ),
            Material(
              color: Colors.white,
              elevation: 1,
              child: TabBar(
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                labelColor: AppColors.primary,
                unselectedLabelColor: Colors.grey.shade600,
                indicatorColor: AppColors.accent,
                indicatorWeight: 3,
                labelStyle:
                    const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w800),
                unselectedLabelStyle:
                    const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600),
                tabs: [
                  for (final k in kinds)
                    Tab(
                      height: 44,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(k.icon, size: 18),
                          const SizedBox(width: 6),
                          Text(k.label),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: TabBarView(
                children: [
                  for (final k in kinds)
                    _ActivityList(
                      key: ValueKey('${k.api}|${_period.key}'),
                      repId: widget.rep.id,
                      kind: k,
                      period: _period,
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryStrip() {
    final s = _stats;
    String v(double Function(SupStats) f) => s == null ? '—' : fmtMoney(f(s));
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: _statsLoading
          ? const SizedBox(
              height: 38,
              child: Center(
                  child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2))))
          : Row(
              children: [
                Expanded(
                    child: MiniStat(
                        label: s == null ? 'مبيعات' : 'مبيعات (${s.salesCount})',
                        value: v((s) => s.sales),
                        color: AppColors.primary)),
                Expanded(
                    child: MiniStat(
                        label: 'تحصيل',
                        value: v((s) => s.collections),
                        color: AppColors.success)),
                Expanded(
                    child: MiniStat(
                        label: 'مرتجعات',
                        value: v((s) => s.returns),
                        color: AppColors.danger)),
                Expanded(
                    child: MiniStat(
                        label: 'الصافي',
                        value: v((s) => s.net),
                        color: AppColors.primaryDark)),
              ],
            ),
    );
  }
}

class _ActivityList extends StatefulWidget {
  const _ActivityList(
      {super.key, required this.repId, required this.kind, required this.period});

  final int repId;
  final ActivityKind kind;
  final SupPeriod period;

  @override
  State<_ActivityList> createState() => _ActivityListState();
}

class _ActivityListState extends State<_ActivityList>
    with AutomaticKeepAliveClientMixin {
  static const _page = 50;

  final _scroll = ScrollController();
  final _items = <SupActivity>[];
  int _total = 0;
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  Object? _moreError;
  int _req = 0;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _loadFirst();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  bool get _hasMore => _items.length < _total;

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _loadMore();
  }

  Future<Map<String, dynamic>> _fetch(int offset) =>
      ApiClient.instance.supervisorRepActivity(
        widget.repId,
        kind: widget.kind.api,
        dateFrom: widget.period.fromIso,
        dateTo: widget.period.toIso,
        limit: _page,
        offset: offset,
      );

  List<SupActivity> _parse(Map<String, dynamic> j) => [
        for (final e in (j['items'] as List? ?? const []))
          if (e is Map) SupActivity.fromJson(e.cast<String, dynamic>())
      ];

  Future<void> _loadFirst() async {
    final my = ++_req;
    setState(() {
      _loading = true;
      _error = null;
      _moreError = null;
    });
    try {
      final j = await _fetch(0);
      if (!mounted || my != _req) return;
      final rows = _parse(j);
      setState(() {
        _items
          ..clear()
          ..addAll(rows);
        _total = (j['total'] as num?)?.toInt() ?? rows.length;
        if (rows.length < _page) _total = _items.length;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || my != _req) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loading || _loadingMore || !_hasMore || _moreError != null) return;
    final my = _req;
    setState(() => _loadingMore = true);
    try {
      final j = await _fetch(_items.length);
      if (!mounted || my != _req) return;
      final rows = _parse(j);
      setState(() {
        _items.addAll(rows);
        _total = (j['total'] as num?)?.toInt() ?? _total;
        if (rows.length < _page) _total = _items.length;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted || my != _req) return;
      setState(() {
        _moreError = e;
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return RefreshIndicator(
        onRefresh: _loadFirst,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [OnlineErrorView(error: _error!, onRetry: _loadFirst)],
        ),
      );
    }
    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadFirst,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            const SizedBox(height: 70),
            Icon(widget.kind.icon, size: 52, color: Colors.grey.shade400),
            const SizedBox(height: 10),
            Text(
              widget.kind == ActivityKind.all
                  ? 'لا توجد حركة في هذه الفترة'
                  : 'لا توجد ${widget.kind.label} في هذه الفترة',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 15, color: Colors.grey.shade700),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadFirst,
      child: ListView.builder(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(top: 6, bottom: 24),
        itemCount: _items.length + 1,
        itemBuilder: (context, i) {
          if (i < _items.length) {
            final it = _items[i];
            return _ActivityTile(
              item: it,
              showKind: widget.kind == ActivityKind.all,
              onTap: it.kind.hasDocument
                  ? () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => RepDocumentScreen(
                              repId: widget.repId, kind: it.kind, id: it.id, preview: it),
                        ),
                      )
                  : null,
            );
          }
          return _footer();
        },
      ),
    );
  }

  Widget _footer() {
    if (_moreError != null) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Center(
          child: TextButton.icon(
            onPressed: () {
              setState(() => _moreError = null);
              _loadMore();
            },
            icon: const Icon(Icons.refresh),
            label: Text('${friendlyError(_moreError!)} — حاول مرة أخرى'),
          ),
        ),
      );
    }
    if (_hasMore) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadMore());
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(
            child: SizedBox(
                width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
      );
    }
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Text('${_items.length} حركة',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12.5, color: Colors.grey.shade500)),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.item, required this.showKind, this.onTap});

  final SupActivity item;
  final bool showKind;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final k = item.kind;
    final details = <String>[
      if (item.cash != null && item.cash != 0) 'نقدي ${fmtMoney(item.cash)}',
      if (item.credit != null && item.credit != 0) 'آجل ${fmtMoney(item.credit)}',
    ];
    final meta = <String>[
      if (item.when.isNotEmpty) item.when,
      if (item.linesCount != null) '${item.linesCount} صنف',
    ];
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: k.color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(k.icon, size: 24, color: k.color),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(item.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 15, fontWeight: FontWeight.w800)),
                        ),
                        if (showKind) ...[
                          const SizedBox(width: 6),
                          _Badge(text: k.single, color: k.color),
                        ],
                      ],
                    ),
                    if (item.partyName != null)
                      Text(item.partyName!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 14)),
                    if (meta.isNotEmpty)
                      Text(meta.join(' · '),
                          style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600)),
                    if (item.status != null || item.note != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            if (item.status != null)
                              _Badge(text: item.status!, color: Colors.blueGrey),
                            if (item.note != null)
                              Text(item.note!,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 12.5, color: Colors.grey.shade700)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (item.amount != null)
                    Text(fmtMoney(item.amount),
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w800, color: k.color)),
                  for (final d in details)
                    Text(d, style: TextStyle(fontSize: 11.5, color: Colors.grey.shade600)),
                  if (onTap != null)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Icon(Icons.chevron_left, size: 20, color: Colors.grey),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color)),
      );
}
