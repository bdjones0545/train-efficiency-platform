import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownLeft, ArrowUpRight, Search, Wallet, DollarSign, Plus, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, parseISO, startOfDay, startOfWeek, startOfMonth, startOfYear, endOfDay, endOfWeek, endOfMonth, endOfYear, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, addYears, subYears, isAfter } from "date-fns";
import type { User } from "@shared/models/auth";

type RevenuePeriod = "daily" | "weekly" | "monthly" | "yearly";

interface TransactionWithUser {
  id: string;
  userId: string;
  type: "CREDIT" | "DEBIT";
  amountCents: number;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  stripeSessionId: string | null;
  createdAt: string;
  user?: User;
  redemptionCoachUserId?: string;
  isOwnerRedemption?: boolean;
}

interface UserBalance {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  balanceCents: number;
}

export default function CoachTransactionsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [balanceSearch, setBalanceSearch] = useState("");
  const [txFilter, setTxFilter] = useState<"all" | "CREDIT" | "DEBIT">("all");
  const [paymentUser, setPaymentUser] = useState<UserBalance | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "venmo">("cash");
  const [revenuePeriod, setRevenuePeriod] = useState<RevenuePeriod>("monthly");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const { data: transactions, isLoading: txLoading } = useQuery<TransactionWithUser[]>({
    queryKey: ["/api/coach/transactions"],
  });

  const { data: userBalances, isLoading: balancesLoading } = useQuery<UserBalance[]>({
    queryKey: ["/api/coach/user-balances"],
  });

  const manualPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!paymentUser) throw new Error("No user selected");
      const cents = Math.round(parseFloat(paymentAmount) * 100);
      if (isNaN(cents) || cents <= 0) throw new Error("Invalid amount");
      const res = await apiRequest("POST", "/api/coach/manual-payment", {
        userId: paymentUser.id,
        amountCents: cents,
        method: paymentMethod,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment Recorded", description: `$${parseFloat(paymentAmount).toFixed(2)} added to ${paymentUser?.firstName || "user"}'s wallet via ${paymentMethod === "cash" ? "Cash" : "Venmo"}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/user-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/transactions"] });
      setPaymentUser(null);
      setPaymentAmount("");
      setPaymentMethod("cash");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const filteredTransactions = (transactions || []).filter(tx => {
    if (txFilter !== "all" && tx.type !== txFilter) return false;
    if (search.length >= 2) {
      const term = search.toLowerCase();
      const userName = `${tx.user?.firstName || ""} ${tx.user?.lastName || ""}`.toLowerCase();
      const desc = (tx.description || "").toLowerCase();
      const email = (tx.user?.email || "").toLowerCase();
      return userName.includes(term) || desc.includes(term) || email.includes(term);
    }
    return true;
  });

  const filteredBalances = (userBalances || []).filter(u => {
    if (balanceSearch.length < 2) return true;
    const term = balanceSearch.toLowerCase();
    const name = `${u.firstName || ""} ${u.lastName || ""}`.toLowerCase();
    const email = (u.email || "").toLowerCase();
    return name.includes(term) || email.includes(term);
  });

  const getPeriodStart = (period: RevenuePeriod, date: Date): Date => {
    switch (period) {
      case "daily": return startOfDay(date);
      case "weekly": return startOfWeek(date, { weekStartsOn: 0 });
      case "monthly": return startOfMonth(date);
      case "yearly": return startOfYear(date);
    }
  };

  const getPeriodEnd = (period: RevenuePeriod, date: Date): Date => {
    switch (period) {
      case "daily": return endOfDay(date);
      case "weekly": return endOfWeek(date, { weekStartsOn: 0 });
      case "monthly": return endOfMonth(date);
      case "yearly": return endOfYear(date);
    }
  };

  const navigatePeriod = (direction: "prev" | "next") => {
    setSelectedDate(prev => {
      const fn = direction === "prev"
        ? { daily: subDays, weekly: subWeeks, monthly: subMonths, yearly: subYears }[revenuePeriod]
        : { daily: addDays, weekly: addWeeks, monthly: addMonths, yearly: addYears }[revenuePeriod];
      return fn(prev, 1);
    });
  };

  const goToToday = () => setSelectedDate(new Date());

  const periodStart = getPeriodStart(revenuePeriod, selectedDate);
  const periodEnd = getPeriodEnd(revenuePeriod, selectedDate);
  const periodTransactions = (transactions || []).filter(t => {
    if (!t.createdAt) return false;
    const d = parseISO(t.createdAt);
    return !isAfter(periodStart, d) && !isAfter(d, periodEnd);
  });

  const periodCredits = periodTransactions.filter(t => t.type === "CREDIT").reduce((sum, t) => sum + t.amountCents, 0);
  const periodDebits = periodTransactions.filter(t => t.type === "DEBIT").reduce((sum, t) => sum + t.amountCents, 0);
  const periodCoachPayouts = periodTransactions.filter(t =>
    t.type === "DEBIT" && t.sourceType === "redemption" && !t.isOwnerRedemption
  ).reduce((sum, t) => sum + t.amountCents, 0);
  const periodNetIncome = periodCredits - periodCoachPayouts;

  const getPeriodLabel = (): string => {
    switch (revenuePeriod) {
      case "daily":
        return format(selectedDate, "MMM d, yyyy");
      case "weekly": {
        const ws = startOfWeek(selectedDate, { weekStartsOn: 0 });
        const we = endOfWeek(selectedDate, { weekStartsOn: 0 });
        return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
      }
      case "monthly":
        return format(selectedDate, "MMMM yyyy");
      case "yearly":
        return format(selectedDate, "yyyy");
    }
  };

  const periodLabel = getPeriodLabel();

  const isCurrentPeriod = (): boolean => {
    const now = new Date();
    return getPeriodStart(revenuePeriod, now).getTime() === periodStart.getTime();
  };

  const totalCredits = (transactions || []).filter(t => t.type === "CREDIT").reduce((sum, t) => sum + t.amountCents, 0);
  const totalDebits = (transactions || []).filter(t => t.type === "DEBIT").reduce((sum, t) => sum + t.amountCents, 0);
  const usersWithBalance = (userBalances || []).filter(u => u.balanceCents !== 0).length;

  if (txLoading || balancesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold" data-testid="text-page-title">Transactions</h1>
        <p className="text-muted-foreground mt-1">View wallet deposits, payments, and user balances</p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Revenue</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["daily", "weekly", "monthly", "yearly"] as RevenuePeriod[]).map((period) => (
              <Button
                key={period}
                size="sm"
                variant={revenuePeriod === period ? "default" : "outline"}
                onClick={() => { setRevenuePeriod(period); setSelectedDate(new Date()); }}
                className={`toggle-elevate ${revenuePeriod === period ? "toggle-elevated" : ""}`}
                data-testid={`button-revenue-${period}`}
              >
                {period === "daily" ? "Daily" : period === "weekly" ? "Weekly" : period === "monthly" ? "Monthly" : "Yearly"}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => navigatePeriod("prev")}
              data-testid="button-period-prev"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              {revenuePeriod === "daily" ? (
                <Input
                  type="date"
                  value={format(selectedDate, "yyyy-MM-dd")}
                  onChange={(e) => {
                    const d = new Date(e.target.value + "T12:00:00");
                    if (!isNaN(d.getTime())) setSelectedDate(d);
                  }}
                  className="w-auto"
                  data-testid="input-date-picker"
                />
              ) : revenuePeriod === "monthly" ? (
                <Input
                  type="month"
                  value={format(selectedDate, "yyyy-MM")}
                  onChange={(e) => {
                    const d = new Date(e.target.value + "-15T12:00:00");
                    if (!isNaN(d.getTime())) setSelectedDate(d);
                  }}
                  className="w-auto"
                  data-testid="input-month-picker"
                />
              ) : (
                <span className="text-sm font-medium px-2 min-w-[120px] text-center" data-testid="text-period-label">
                  {periodLabel}
                </span>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => navigatePeriod("next")}
              data-testid="button-period-next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {!isCurrentPeriod() && (
            <Button
              size="sm"
              variant="outline"
              onClick={goToToday}
              data-testid="button-go-to-today"
            >
              Today
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Revenue ({periodLabel})</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-period-deposits">
              ${(periodCredits / 100).toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Coach Payouts ({periodLabel})</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400" data-testid="text-period-coach-payouts">
              ${(periodCoachPayouts / 100).toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Net Income ({periodLabel})</p>
            <p className={`text-xl font-bold ${periodNetIncome >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-period-net-income">
              {periodNetIncome < 0 ? "-" : ""}${(Math.abs(periodNetIncome) / 100).toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">All Debits ({periodLabel})</p>
            <p className="text-xl font-bold text-muted-foreground" data-testid="text-period-payments">
              ${(periodDebits / 100).toFixed(2)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="text-period-count">
          {periodTransactions.length} transaction{periodTransactions.length !== 1 ? "s" : ""} in this period
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownLeft className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="text-sm text-muted-foreground">All-Time Deposits</span>
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-deposits">
            ${(totalCredits / 100).toFixed(2)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-sm text-muted-foreground">All-Time Payments</span>
          </div>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-total-payments">
            ${(totalDebits / 100).toFixed(2)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="h-4 w-4 text-primary" />
            <span className="text-sm text-muted-foreground">Users with Balance</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-users-with-balance">
            {usersWithBalance}
          </p>
        </Card>
      </div>

      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions" data-testid="tab-transactions">Transactions</TabsTrigger>
          <TabsTrigger value="balances" data-testid="tab-balances">User Balances</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by user name, email, or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-transactions"
              />
            </div>
            <div className="flex gap-1">
              <Button
                variant={txFilter === "all" ? "default" : "outline"}
                onClick={() => setTxFilter("all")}
                className={`toggle-elevate ${txFilter === "all" ? "toggle-elevated" : ""}`}
                data-testid="button-filter-all"
              >
                All
              </Button>
              <Button
                variant={txFilter === "CREDIT" ? "default" : "outline"}
                onClick={() => setTxFilter("CREDIT")}
                className={`toggle-elevate ${txFilter === "CREDIT" ? "toggle-elevated" : ""}`}
                data-testid="button-filter-deposits"
              >
                Deposits
              </Button>
              <Button
                variant={txFilter === "DEBIT" ? "default" : "outline"}
                onClick={() => setTxFilter("DEBIT")}
                className={`toggle-elevate ${txFilter === "DEBIT" ? "toggle-elevated" : ""}`}
                data-testid="button-filter-payments"
              >
                Payments
              </Button>
            </div>
          </div>

          <Card className="divide-y">
            {filteredTransactions.length === 0 ? (
              <div className="p-8 text-center">
                <DollarSign className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No transactions found</p>
              </div>
            ) : (
              filteredTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-4 p-4"
                  data-testid={`row-transaction-${tx.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {tx.type === "CREDIT" ? (
                      <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                        <ArrowDownLeft className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                        <ArrowUpRight className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">
                          {tx.description || (tx.type === "CREDIT" ? "Funds Added" : "Session Payment")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {tx.user ? `${tx.user.firstName || ""} ${tx.user.lastName || ""}`.trim() || "Unknown User" : "Unknown User"}
                        </span>
                        {tx.user?.email && (
                          <span className="text-xs text-muted-foreground">({tx.user.email})</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {tx.createdAt ? format(parseISO(tx.createdAt), "MMM d, yyyy h:mm a") : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Badge className={tx.type === "CREDIT"
                    ? "bg-green-500/15 text-green-700 dark:text-green-400 no-default-hover-elevate no-default-active-elevate shrink-0"
                    : "bg-red-500/15 text-red-700 dark:text-red-400 no-default-hover-elevate no-default-active-elevate shrink-0"
                  }>
                    {tx.type === "CREDIT" ? "+" : "-"}${(tx.amountCents / 100).toFixed(2)}
                  </Badge>
                </div>
              ))
            )}
          </Card>
          {filteredTransactions.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Showing {filteredTransactions.length} of {(transactions || []).length} transactions
            </p>
          )}
        </TabsContent>

        <TabsContent value="balances" className="space-y-4 mt-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={balanceSearch}
              onChange={(e) => setBalanceSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-balances"
            />
          </div>

          <Card className="divide-y">
            {filteredBalances.length === 0 ? (
              <div className="p-8 text-center">
                <Wallet className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No users found</p>
              </div>
            ) : (
              filteredBalances.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-4 p-4"
                  data-testid={`row-balance-${user.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {(user.firstName?.[0] || "U").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {`${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown User"}
                      </p>
                      {user.email && (
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-sm font-semibold ${
                        user.balanceCents > 0
                          ? "text-green-600 dark:text-green-400"
                          : user.balanceCents < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-muted-foreground"
                      }`}
                      data-testid={`text-balance-${user.id}`}
                    >
                      {user.balanceCents < 0
                        ? `-$${(Math.abs(user.balanceCents) / 100).toFixed(2)}`
                        : `$${(user.balanceCents / 100).toFixed(2)}`}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { setPaymentUser(user); setPaymentAmount(""); setPaymentMethod("cash"); }}
                      data-testid={`button-record-payment-${user.id}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </Card>
          {filteredBalances.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Showing {filteredBalances.length} users
            </p>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!paymentUser} onOpenChange={(open) => { if (!open) setPaymentUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="text-sm">
              Adding funds to <span className="font-semibold">{`${paymentUser?.firstName || ""} ${paymentUser?.lastName || ""}`.trim() || "User"}</span>'s wallet
            </div>

            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "venmo")}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="venmo">Venmo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                data-testid="input-payment-amount"
              />
            </div>

            <Button
              className="w-full"
              onClick={() => manualPaymentMutation.mutate()}
              disabled={manualPaymentMutation.isPending || !paymentAmount || parseFloat(paymentAmount) <= 0}
              data-testid="button-confirm-payment"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              {manualPaymentMutation.isPending ? "Recording..." : `Record ${paymentMethod === "cash" ? "Cash" : "Venmo"} Payment`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
