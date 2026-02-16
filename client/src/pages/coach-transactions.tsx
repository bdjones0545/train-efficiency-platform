import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowDownLeft, ArrowUpRight, Search, Wallet, DollarSign } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { User } from "@shared/models/auth";

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
}

interface UserBalance {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  balanceCents: number;
}

export default function CoachTransactionsPage() {
  const [search, setSearch] = useState("");
  const [balanceSearch, setBalanceSearch] = useState("");
  const [txFilter, setTxFilter] = useState<"all" | "CREDIT" | "DEBIT">("all");

  const { data: transactions, isLoading: txLoading } = useQuery<TransactionWithUser[]>({
    queryKey: ["/api/coach/transactions"],
  });

  const { data: userBalances, isLoading: balancesLoading } = useQuery<UserBalance[]>({
    queryKey: ["/api/coach/user-balances"],
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownLeft className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="text-sm text-muted-foreground">Total Deposits</span>
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-deposits">
            ${(totalCredits / 100).toFixed(2)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowUpRight className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-sm text-muted-foreground">Total Payments</span>
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
                  <span
                    className={`text-sm font-semibold shrink-0 ${
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
    </div>
  );
}
