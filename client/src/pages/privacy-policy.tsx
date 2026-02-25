import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Button variant="ghost" size="sm" className="mb-8" onClick={() => window.history.back()} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        <h1 className="text-3xl font-bold mb-2" data-testid="text-privacy-title">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">1. Introduction</h2>
            <p className="text-muted-foreground leading-relaxed">
              Train Efficiency Business Solutions ("we," "our," or "us") operates the TrainEfficiency.com platform. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform, including any organization-branded pages hosted on our service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">2. Information We Collect</h2>
            <p className="text-muted-foreground leading-relaxed">We collect information you provide directly to us, including:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Name, email address, and account credentials</li>
              <li>Business information (organization name, logo, branding details)</li>
              <li>Payment information processed through Stripe (we do not store full card details)</li>
              <li>Scheduling data, session bookings, and availability preferences</li>
              <li>Communications between coaches, clients, and administrators</li>
              <li>Usage data and analytics related to platform interaction</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
            <p className="text-muted-foreground leading-relaxed">We use collected information to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Provide, maintain, and improve the platform</li>
              <li>Process transactions and send related notifications</li>
              <li>Send booking confirmations, payment receipts, and session reminders</li>
              <li>Manage organization subscriptions and billing</li>
              <li>Provide customer support and respond to inquiries</li>
              <li>Send administrative emails about platform updates or policy changes</li>
              <li>Detect, investigate, and prevent fraudulent or unauthorized activity</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">4. Information Sharing</h2>
            <p className="text-muted-foreground leading-relaxed">We may share your information with:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li><strong>Organization administrators and coaches</strong> — your booking and profile data is visible to the coaching organization you interact with</li>
              <li><strong>Payment processors</strong> — Stripe processes all payment transactions</li>
              <li><strong>Email service providers</strong> — SendGrid delivers transactional emails on our behalf</li>
              <li><strong>Legal requirements</strong> — when required by law or to protect our rights</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed">We do not sell your personal information to third parties.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">5. Data Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement appropriate technical and organizational measures to protect your personal information. Passwords are hashed and stored securely. Payment processing is handled entirely by Stripe, a PCI-compliant payment processor. However, no method of transmission over the Internet is 100% secure.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">6. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your personal information for as long as your account is active or as needed to provide services. If you or your organization administrator requests account deletion, we will remove your data within a reasonable timeframe, except where retention is required by law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">7. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to or restrict certain data processing</li>
              <li>Data portability</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed">To exercise these rights, contact us at the email address provided below.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">8. Cookies and Tracking</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use essential cookies and local storage to maintain your session, authentication state, and preferences. We do not use third-party advertising trackers.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">9. Children's Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Our platform is not intended for children under 13. We do not knowingly collect personal information from children under 13. If you believe we have collected such information, please contact us immediately.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">10. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last updated" date.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">11. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have questions about this Privacy Policy, please contact us at support@trainefficiency.com.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
