import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Dumbbell, CheckCircle2, Upload, Lock, FileText, Image, X, AlertCircle, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf", "image/heic", "image/heif"];
const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf", ".heic"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function trackEvent(name: string, props?: Record<string, unknown>) {
  console.log(`[Analytics] ${name}`, props ?? {});
}

async function logFunnelEvent(eventType: string, email?: string, metadata?: Record<string, unknown>) {
  try {
    const res = await fetch("/api/book-funnel/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email ?? undefined,
        eventType,
        metadata: { source: "book_redeem", ...(metadata ?? {}) },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type UploadState = "idle" | "uploading" | "success" | "error";

type StepStatus = "done" | "active" | "upcoming";

function ProgressStepper() {
  const steps: { label: string; status: StepStatus }[] = [
    { label: "Email Submitted", status: "done" },
    { label: "Amazon Purchase", status: "done" },
    { label: "Upload Receipt", status: "active" },
    { label: "Approval", status: "upcoming" },
    { label: "TrainChat Activated", status: "upcoming" },
  ];

  return (
    <div className="flex items-center justify-center gap-0 mb-14 flex-wrap gap-y-3" data-testid="progress-stepper">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={[
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all",
                step.status === "done"
                  ? "bg-[#ffd274] text-[#402d00]"
                  : step.status === "active"
                  ? "border-2 border-[#ffd274] text-[#ffd274] bg-[#ffd274]/10"
                  : "border border-[#4f4634] text-[#9c8f7a] bg-[#1c1b1b]",
              ].join(" ")}
              data-testid={`step-indicator-${i}`}
            >
              {step.status === "done" ? <CheckCircle2 className="w-4 h-4" /> : <span>{i + 1}</span>}
            </div>
            <span
              className={[
                "text-[10px] font-bold tracking-widest uppercase mt-1.5 text-center max-w-[72px]",
                step.status === "done"
                  ? "text-[#9c8f7a]"
                  : step.status === "active"
                  ? "text-[#ffd274]"
                  : "text-[#4f4634]",
              ].join(" ")}
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={[
                "w-8 md:w-12 h-px mx-1 mb-5 shrink-0",
                step.status === "done" ? "bg-[#ffd274]/40" : "bg-[#4f4634]/50",
              ].join(" ")}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function BookRedeemPage() {
  const [, navigate] = useLocation();

  const emailFromUrl = new URLSearchParams(window.location.search).get("email") ?? "";
  const [email, setEmail] = useState(emailFromUrl ? decodeURIComponent(emailFromUrl) : "");
  const [emailError, setEmailError] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [serverError, setServerError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasTrackedView = useRef(false);

  useEffect(() => {
    if (hasTrackedView.current) return;
    hasTrackedView.current = true;
    trackEvent("book_receipt_page_viewed", { email });
    logFunnelEvent("book_receipt_page_viewed", email || undefined);
  }, [email]);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, [filePreviewUrl]);

  function validateEmail(val: string) {
    if (!val.trim()) return "Email address is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) return "Please enter a valid email address.";
    return "";
  }

  function validateFile(f: File): string {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    const mimeOk = ACCEPTED_TYPES.includes(f.type) || f.type === "" || f.type === "application/octet-stream";
    const extOk = ACCEPTED_EXTENSIONS.includes(ext);
    if (!mimeOk && !extOk) return "Unsupported file type. Please upload a JPG, PNG, PDF, or HEIC file.";
    if (!extOk) return "Unsupported file type. Please upload a JPG, PNG, PDF, or HEIC file.";
    if (f.size > MAX_SIZE_BYTES) return `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 10 MB.`;
    return "";
  }

  function handleFileSelected(f: File) {
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      setFile(null);
      setFilePreviewUrl(null);
      trackEvent("book_receipt_selected", { valid: false, error: err });
      logFunnelEvent("book_receipt_selected", email || undefined, { valid: false, error: err });
      return;
    }
    setFileError("");
    setFile(f);
    trackEvent("book_receipt_selected", { valid: true, type: f.type, size: f.size });
    logFunnelEvent("book_receipt_selected", email || undefined, { valid: true, type: f.type, size: f.size });

    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    if (f.type.startsWith("image/")) {
      setFilePreviewUrl(URL.createObjectURL(f));
    } else {
      setFilePreviewUrl(null);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) handleFileSelected(selected);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFileSelected(dropped);
  }

  function handleRemoveFile() {
    setFile(null);
    setFileError("");
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const emailErr = validateEmail(email);
    setEmailError(emailErr);
    if (emailErr) return;

    if (!file) {
      setFileError("Please select a file to upload.");
      return;
    }

    setUploadState("uploading");
    setUploadProgress(0);
    setServerError("");

    try {
      const formData = new FormData();
      formData.append("email", email.trim().toLowerCase());
      formData.append("receipt", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/book-funnel/receipt");

      xhr.upload.addEventListener("progress", (ev) => {
        if (ev.lengthComputable) {
          setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      });

      const result = await new Promise<{ ok: boolean; data: unknown }>((resolve) => {
        xhr.addEventListener("load", () => {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
          } catch {
            resolve({ ok: false, data: { error: "Unexpected server response." } });
          }
        });
        xhr.addEventListener("error", () => resolve({ ok: false, data: { error: "Network error. Please check your connection and try again." } }));
        xhr.send(formData);
      });

      if (result.ok) {
        setUploadState("success");
        const data = result.data as any;
        trackEvent("book_receipt_uploaded", { email });
        logFunnelEvent("book_receipt_uploaded", email || undefined, { filename: file.name });
        const params = new URLSearchParams();
        if (data?.submissionId) params.set("submissionId", data.submissionId);
        if (email) params.set("email", encodeURIComponent(email.trim().toLowerCase()));
        if (data?.promoCode) params.set("promoCode", data.promoCode);
        setTimeout(() => navigate(`/book/redeem/success?${params.toString()}`), 800);
      } else {
        const errMsg = (result.data as any)?.error ?? "Upload failed. Please try again.";
        setServerError(errMsg);
        setUploadState("error");
        trackEvent("book_receipt_upload_failed", { email, error: errMsg });
        logFunnelEvent("book_receipt_upload_failed", email || undefined, { error: errMsg });
      }
    } catch (err: any) {
      const errMsg = "Network error. Please check your connection and try again.";
      setServerError(errMsg);
      setUploadState("error");
      trackEvent("book_receipt_upload_failed", { email, error: errMsg });
      logFunnelEvent("book_receipt_upload_failed", email || undefined, { error: errMsg });
    }
  }

  const isUploading = uploadState === "uploading";

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] selection:bg-[#ffd274]/30 selection:text-[#ffd274]">
      {/* Nav */}
      <header className="fixed top-0 w-full z-50 bg-[#131313]/80 backdrop-blur-xl border-b border-white/10">
        <nav className="flex justify-between items-center px-6 md:px-8 py-4 max-w-[1200px] mx-auto">
          <a
            href="/book"
            className="flex items-center gap-2 transition-transform active:scale-95"
            data-testid="link-redeem-nav-home"
          >
            <Dumbbell className="h-5 w-5 text-[#ffd274]" />
            <span className="font-bold text-lg text-[#ffd274] tracking-tight">TrainEfficiency</span>
          </a>
          <div className="hidden md:flex gap-8 items-center">
            <a
              href="/book"
              className="text-[10px] font-bold tracking-widest uppercase text-[#9c8f7a] hover:text-[#ffd274] transition-colors"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Overview
            </a>
            <span
              className="text-[10px] font-bold tracking-widest uppercase text-[#ffd274] border-b-2 border-[#ffd274] pb-0.5"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Redeem Bonus
            </span>
          </div>
        </nav>
      </header>

      <main className="pt-28 pb-32 px-5 md:px-8 max-w-[800px] mx-auto min-h-screen">

        {/* Hero */}
        <section className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-[#ffd274]/10 border border-[#ffd274]/20 px-4 py-1.5 rounded-full mb-6">
            <span
              className="text-[11px] font-bold tracking-widest uppercase text-[#ffd274]"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Exclusive Bonus Access
            </span>
          </div>
          <h1
            className="text-[40px] md:text-[52px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[#e5e2e1] mb-4"
            data-testid="text-redeem-headline"
          >
            Redeem Your TrainChat Bonus
          </h1>
          <p className="text-lg text-[#d3c5ae] max-w-[560px] mx-auto leading-relaxed">
            Upload your Amazon purchase confirmation to verify your purchase and activate your free month of TrainChat.
          </p>
        </section>

        {/* Progress Stepper */}
        <ProgressStepper />

        {/* Upload Form Card */}
        <form onSubmit={handleSubmit} noValidate>
          <div
            className="bg-[#1c1b1b] border border-white/5 rounded-2xl p-8 md:p-12 shadow-[0_8px_48px_rgba(0,0,0,0.6)] relative overflow-hidden mb-8"
            style={{ boxShadow: "0 0 60px rgba(246,190,55,0.06), 0 8px 48px rgba(0,0,0,0.6)" }}
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#ffd274]/5 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none" />

            {/* Section 1: File Upload */}
            <div className="mb-10 relative">
              <div className="flex items-center gap-3 mb-2">
                <span
                  className="w-6 h-6 rounded-full bg-[#ffd274] text-[#402d00] text-xs font-bold flex items-center justify-center shrink-0"
                >
                  1
                </span>
                <h3 className="text-[22px] font-bold text-[#e5e2e1]">Upload your receipt</h3>
              </div>
              <p className="text-sm text-[#9c8f7a] ml-9">
                Drag and drop your file or click to browse.
              </p>
            </div>

            {/* Drop Zone */}
            <div
              className={[
                "relative border-2 border-dashed rounded-xl p-10 transition-all duration-300 flex flex-col items-center justify-center text-center cursor-pointer group",
                dragOver
                  ? "border-[#ffd274] bg-[#ffd274]/5"
                  : file
                  ? "border-[#ffd274]/50 bg-[#ffd274]/[0.03]"
                  : "border-[#4f4634] hover:border-[#ffd274]/40 bg-[#131313]/50",
              ].join(" ")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !file && fileInputRef.current?.click()}
              data-testid="drop-zone-receipt"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,.heic"
                className="hidden"
                onChange={handleInputChange}
                data-testid="input-file-receipt"
              />

              {!file ? (
                /* Empty state */
                <div className="flex flex-col items-center">
                  <div
                    className="w-16 h-16 rounded-full bg-[#2a2a2a] flex items-center justify-center mb-6 group-hover:bg-[#ffd274] group-hover:text-[#402d00] transition-colors duration-300 text-[#9c8f7a]"
                  >
                    <Upload className="w-7 h-7" />
                  </div>
                  <p className="text-[20px] font-bold text-[#e5e2e1] mb-2">Click or drag file here</p>
                  <p className="text-sm text-[#9c8f7a]">JPG, JPEG, PNG, PDF, or HEIC · Max 10 MB</p>
                </div>
              ) : (
                /* File selected state */
                <div className="flex flex-col items-center w-full" onClick={(e) => e.stopPropagation()}>
                  {filePreviewUrl ? (
                    <img
                      src={filePreviewUrl}
                      alt="Receipt preview"
                      className="max-h-40 max-w-xs rounded-lg border border-white/10 mb-4 object-contain shadow-lg"
                      data-testid="img-receipt-preview"
                    />
                  ) : (
                    <div className="w-20 h-24 bg-[#2a2a2a] rounded-lg flex flex-col items-center justify-center border border-white/10 mb-4 relative overflow-hidden">
                      <FileText className="w-8 h-8 text-[#9c8f7a]" />
                      <div className="absolute bottom-0 left-0 right-0 bg-[#ffd274] text-[#402d00] text-[9px] font-bold py-1 text-center">
                        {file.name.split(".").pop()?.toUpperCase()}
                      </div>
                    </div>
                  )}
                  <p className="text-sm font-semibold text-[#ffd274] mb-1 max-w-xs truncate" data-testid="text-file-name">
                    {file.name}
                  </p>
                  <p className="text-xs text-[#9c8f7a] mb-3">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="flex items-center gap-1 text-[#ffb4ab] text-xs font-bold tracking-widest uppercase hover:underline"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                    data-testid="button-remove-file"
                  >
                    <X className="w-3 h-3" />
                    Remove File
                  </button>
                </div>
              )}
            </div>

            {fileError && (
              <div className="flex items-start gap-2 mt-3 text-[#ffb4ab] text-sm" data-testid="error-file">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{fileError}</span>
              </div>
            )}

            {/* Upload Progress */}
            {isUploading && (
              <div className="mt-4" data-testid="upload-progress">
                <div className="flex justify-between text-xs text-[#9c8f7a] mb-1">
                  <span>Uploading…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#ffd274] rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Section 2: Email */}
            <div className="mt-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-6 h-6 rounded-full bg-[#ffd274] text-[#402d00] text-xs font-bold flex items-center justify-center shrink-0">
                  2
                </span>
                <label
                  htmlFor="email-input"
                  className="text-[11px] font-bold tracking-widest uppercase text-[#9c8f7a]"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  Your Delivery Email
                </label>
              </div>
              <input
                id="email-input"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                placeholder="coach@example.com"
                className="w-full bg-[#2a2a2a] border-b-2 border-[#4f4634] focus:border-[#ffd274] focus:outline-none text-[#e5e2e1] py-4 px-2 placeholder:text-[#9c8f7a]/40 transition-colors duration-300 text-base"
                autoComplete="email"
                data-testid="input-email"
              />
              {emailError && (
                <div className="flex items-start gap-2 mt-2 text-[#ffb4ab] text-sm" data-testid="error-email">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{emailError}</span>
                </div>
              )}
            </div>

            {/* Server-level error */}
            {serverError && (
              <div className="mt-6 bg-[#93000a]/20 border border-[#ffb4ab]/20 rounded-xl px-4 py-3 flex items-start gap-3" data-testid="error-server">
                <AlertCircle className="w-4 h-4 text-[#ffb4ab] mt-0.5 shrink-0" />
                <p className="text-sm text-[#ffb4ab]">{serverError}</p>
              </div>
            )}

            {/* Submit */}
            <div className="mt-12">
              <button
                type="submit"
                disabled={isUploading || uploadState === "success"}
                className="w-full bg-[#ffd274] text-[#402d00] font-extrabold text-base tracking-widest uppercase py-5 rounded-full hover:bg-[#ebb42d] hover:scale-[1.01] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none flex items-center justify-center gap-3 shadow-[inset_0_0_12px_rgba(255,255,255,0.3)] hover:shadow-[0_0_40px_rgba(246,190,55,0.3)]"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                data-testid="button-submit-receipt"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Uploading…
                  </>
                ) : uploadState === "success" ? (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    Uploaded!
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Submit Receipt
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 mt-5 text-[#9c8f7a] text-xs">
                <Lock className="w-3 h-3 text-[#ffd274]" />
                <span>Your receipt is processed securely. We never share your data.</span>
              </div>
            </div>
          </div>

          {/* Back button */}
          <div className="flex justify-center mb-10">
            <a
              href="/book"
              className="flex items-center gap-2 text-sm text-[#9c8f7a] hover:text-[#e5e2e1] transition-colors"
              data-testid="link-back-to-book"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Book Page
            </a>
          </div>
        </form>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-16">
          {/* Acceptable receipts */}
          <div
            className="bg-[#1c1b1b] border border-white/5 border-l-4 border-l-[#ffd274]/40 rounded-xl p-6"
            data-testid="card-acceptable-receipts"
          >
            <h4
              className="text-[10px] font-bold tracking-widest uppercase text-[#ffd274] mb-3"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Acceptable Receipts
            </h4>
            <ul className="space-y-1.5">
              {[
                "Amazon order confirmation page",
                "Amazon order history screenshot",
                "Amazon confirmation email screenshot",
                "Amazon invoice PDF",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-[#d3c5ae]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#ffd274] mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-xs text-[#9c8f7a] mt-4 italic">
              We only need enough information to verify your purchase.
            </p>
          </div>

          {/* Processing time */}
          <div
            className="bg-[#1c1b1b] border border-white/5 border-l-4 border-l-[#c6c6c7]/30 rounded-xl p-6"
            data-testid="card-processing-time"
          >
            <h4
              className="text-[10px] font-bold tracking-widest uppercase text-[#c6c6c7] mb-3"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Where Is My Receipt?
            </h4>
            <p className="text-sm text-[#d3c5ae] mb-4 leading-relaxed">
              Log in to Amazon, go to <strong className="text-[#e5e2e1]">"Your Orders,"</strong> and click <strong className="text-[#e5e2e1]">"View Invoice"</strong> to download a PDF or take a screenshot.
            </p>
            <div className="flex items-center gap-2 text-xs text-[#9c8f7a] bg-[#131313] rounded-lg px-3 py-2">
              <Image className="w-3.5 h-3.5 text-[#ffd274] shrink-0" />
              <span>Screenshots and photos of physical invoices are accepted.</span>
            </div>
          </div>
        </div>

        {/* Trust row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 opacity-60 text-sm">
          {[
            { icon: "🔒", label: "Secure Upload" },
            { icon: "👀", label: "Manual Review" },
            { icon: "⚡", label: "Fast Activation" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 justify-center">
              <span className="text-base">{item.icon}</span>
              <span className="font-semibold text-[#d3c5ae]">{item.label}</span>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-16 bg-[#0e0e0e] border-t border-[#4f4634]">
        <div className="max-w-[1200px] mx-auto px-6 md:px-8 flex flex-col md:flex-row justify-between gap-6 items-start md:items-center">
          <div>
            <p className="font-bold text-lg text-[#e5e2e1]">TrainEfficiency</p>
            <p className="text-sm text-[#9c8f7a] mt-1">
              © {new Date().getFullYear()} TrainEfficiency. All Rights Reserved. Evidence-Based Performance.
            </p>
          </div>
          <div className="flex gap-8">
            {["Terms", "Privacy", "Support"].map((link) => (
              <a key={link} href="#" className="text-sm text-[#9c8f7a] hover:text-[#e5e2e1] transition-colors">
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
