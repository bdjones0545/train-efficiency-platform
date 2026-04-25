import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Mail, Search, CheckCircle, XCircle, RefreshCw, Filter } from "lucide-react";
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import type { CommunicationLog } from "@shared/schema";

const TYPE_LABELS: Record<string, string> = {
  booking_confirmation: "Booking Confirmation",
  cancellation: "Cancellation",
  reschedule: "Reschedule",
  recurring: "Recurring",
  reminder: "Reminder",
  outreach: "Outreach",
};

const TYPE_COLORS: Record<string, string> = {
  booking_confirmation: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancellation: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  reschedule: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  recurring: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  reminder: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  outreach: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

export default function CommunicationHistoryPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: logs, isLoading, refetch, isFetching } = useQuery<CommunicationLog[]>({
    queryKey: ["/api/communication-logs"],
  });

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter((log) => {
      if (typeFilter !== "all" && log.type !== typeFilter) return false;
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchEmail = log.recipientEmail.toLowerCase().includes(q);
        const matchSubject = log.subject.toLowerCase().includes(q);
        if (!matchEmail && !matchSubject) return false;
      }
      if (dateFrom) {
        const from = startOfDay(parseISO(dateFrom));
        const sentAt = log.sentAt ? parseISO(log.sentAt as unknown as string) : null;
        if (!sentAt || isBefore(sentAt, from)) return false;
      }
      if (dateTo) {
        const to = endOfDay(parseISO(dateTo));
        const sentAt = log.sentAt ? parseISO(log.sentAt as unknown as string) : null;
        if (!sentAt || isAfter(sentAt, to)) return false;
      }
      return true;
    });
  }, [logs, typeFilter, statusFilter, search, dateFrom, dateTo]);

  const sentCount = logs?.filter((l) => l.status === "sent").length ?? 0;
  const failedCount = logs?.filter((l) => l.status === "failed").length ?? 0;

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const hasFilters = search || typeFilter !== "all" || statusFilter !== "all" || dateFrom || dateTo;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="heading-communication-history">
            Communication History
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Email delivery log for your organization
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-logs"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card data-testid="card-total-sent">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Logged</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold" data-testid="text-total-count">{logs?.length ?? 0}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-sent-count">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Delivered</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-sent-count">{sentCount}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-failed-count">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Failed</p>
                {isLoading ? (
                  <Skeleton className="h-6 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-failed-count">{failedCount}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email or subject..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger data-testid="select-type-filter">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="booking_confirmation">Booking Confirmation</SelectItem>
                <SelectItem value="cancellation">Cancellation</SelectItem>
                <SelectItem value="reschedule">Reschedule</SelectItem>
                <SelectItem value="recurring">Recurring</SelectItem>
                <SelectItem value="reminder">Reminder</SelectItem>
                <SelectItem value="outreach">Outreach</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger data-testid="select-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 items-center">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-sm"
                data-testid="input-date-from"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
            <div className="lg:col-span-4 flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">To:</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-sm max-w-[180px]"
                data-testid="input-date-to"
              />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground" data-testid="text-empty-state">
                <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No communication logs found</p>
                <p className="text-sm mt-1">
                  {hasFilters ? "Try adjusting your filters" : "Emails will appear here once sent"}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Sent At</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Recipient</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Subject</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Channel</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log, idx) => (
                    <tr
                      key={log.id}
                      className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                      data-testid={`row-communication-log-${log.id}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground" data-testid={`text-sent-at-${log.id}`}>
                        {log.sentAt
                          ? format(parseISO(log.sentAt as unknown as string), "MMM d, yyyy h:mm a")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[log.type] ?? "bg-muted text-muted-foreground"}`}
                          data-testid={`badge-type-${log.id}`}
                        >
                          {TYPE_LABELS[log.type] ?? log.type}
                        </span>
                      </td>
                      <td className="px-4 py-3" data-testid={`text-recipient-${log.id}`}>
                        {log.recipientEmail}
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate" data-testid={`text-subject-${log.id}`} title={log.subject}>
                        {log.subject}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.status === "sent" ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-0" data-testid={`badge-status-${log.id}`}>
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Sent
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-0" data-testid={`badge-status-${log.id}`}>
                            <XCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                        {log.errorMessage && (
                          <p className="text-xs text-red-500 mt-0.5 max-w-[160px] truncate" title={log.errorMessage}>
                            {log.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground capitalize" data-testid={`text-channel-${log.id}`}>
                        {log.channel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!isLoading && filtered.length > 0 && (
            <div className="px-4 py-3 border-t text-xs text-muted-foreground" data-testid="text-results-count">
              Showing {filtered.length} of {logs?.length ?? 0} logs
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
