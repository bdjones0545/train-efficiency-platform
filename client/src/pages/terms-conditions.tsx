import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TermsConditionsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Button variant="ghost" size="sm" className="mb-8" onClick={() => window.history.back()} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        <h1 className="text-3xl font-bold mb-2" data-testid="text-terms-title">Terms & Conditions</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using the Train Efficiency Business Solutions platform ("Platform"), you agree to be bound by these Terms & Conditions. If you do not agree, you may not use the Platform.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">2. Description of Service</h2>
            <p className="text-muted-foreground leading-relaxed">
              Train Efficiency provides a white-label scheduling, payment, and business management platform for strength & conditioning coaching businesses. The Platform enables organizations to manage coaches, clients, scheduling, payments, team contracts, and payouts.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">3. Account Registration</h2>
            <p className="text-muted-foreground leading-relaxed">
              To use the Platform, you must register an account and provide accurate, complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">4. Subscription & Billing</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Organizations are offered a free 3-day trial upon registration. No credit card is required to start the trial.</li>
              <li>After the trial period, a subscription of $49.99 per month is required to continue using the Platform.</li>
              <li>Subscriptions are billed monthly through Stripe. You authorize us to charge the payment method on file.</li>
              <li>You may cancel your subscription at any time. Access continues until the end of the current billing period.</li>
              <li>We reserve the right to change subscription pricing with 30 days' advance notice.</li>
              <li>Promotional codes, when provided, may grant modified pricing terms as specified at the time of redemption.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">5. Organization Responsibilities</h2>
            <p className="text-muted-foreground leading-relaxed">Organization administrators are responsible for:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Managing their coaches, clients, and organization settings</li>
              <li>Ensuring their use of the Platform complies with all applicable laws</li>
              <li>Content displayed on their branded landing page</li>
              <li>Proper configuration and management of their Stripe payment integration</li>
              <li>Accurate representation of services, pricing, and business information</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">6. Payment Processing</h2>
            <p className="text-muted-foreground leading-relaxed">
              Payment processing for client transactions (session payments, wallet deposits, team contracts) is handled through Stripe using each organization's own Stripe account. Train Efficiency is not a party to transactions between organizations and their clients. We do not hold, manage, or guarantee funds transferred between organizations and their clients.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">7. Acceptable Use</h2>
            <p className="text-muted-foreground leading-relaxed">You agree not to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1">
              <li>Use the Platform for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to any part of the Platform</li>
              <li>Interfere with or disrupt the Platform's operation</li>
              <li>Upload malicious code, viruses, or harmful content</li>
              <li>Impersonate another person or organization</li>
              <li>Scrape, data-mine, or extract data from the Platform without authorization</li>
              <li>Use the Platform to send spam or unsolicited communications</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">8. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Platform, including its design, code, features, and branding, is owned by Train Efficiency Business Solutions. Organizations retain ownership of their own content, logos, and branding materials uploaded to the Platform. You grant us a license to display your content as necessary to operate the service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">9. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              To the maximum extent permitted by law, Train Efficiency Business Solutions shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business opportunities, arising from your use of the Platform. Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">10. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Platform is provided "as is" and "as available" without warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Platform will be uninterrupted, error-free, or secure.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">11. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may suspend or terminate your access to the Platform at any time for violation of these Terms, non-payment, or any other reason at our discretion. Upon termination, your right to use the Platform ceases immediately. We may retain your data as required by law or for legitimate business purposes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">12. Indemnification</h2>
            <p className="text-muted-foreground leading-relaxed">
              You agree to indemnify and hold harmless Train Efficiency Business Solutions, its officers, directors, employees, and agents from any claims, damages, losses, or expenses arising from your use of the Platform or violation of these Terms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">13. Modifications</h2>
            <p className="text-muted-foreground leading-relaxed">
              We reserve the right to modify these Terms at any time. We will notify users of material changes via email or a notice on the Platform. Continued use of the Platform after changes constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">14. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">
              These Terms shall be governed by and construed in accordance with the laws of the United States. Any disputes shall be resolved through binding arbitration or in the courts of competent jurisdiction.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">15. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have questions about these Terms & Conditions, please contact us at support@trainefficiency.com.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
