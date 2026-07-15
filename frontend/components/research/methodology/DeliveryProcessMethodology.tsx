"use client";
import { Paper, H2, P, UL, LI, Code, Highlight } from "./prose";

// Timeline row (text, not numbers) for the tender → settle flow.
function Timeline({ rows }: { rows: { stage: string; when: string; what: React.ReactNode }[] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="pb-1.5 pr-4">Stage</th>
            <th className="pb-1.5 pr-4">When</th>
            <th className="pb-1.5">What happens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-800 align-top">
              <td className="py-1.5 pr-4 text-slate-200 font-semibold whitespace-nowrap">{r.stage}</td>
              <td className="py-1.5 pr-4 text-amber-300/90 font-mono whitespace-nowrap">{r.when}</td>
              <td className="py-1.5 text-slate-300 leading-relaxed">{r.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DeliveryProcessMethodology() {
  return (
    <Paper
      kicker="Contract rules · Delivery"
      title="Robusta delivery — the ICE tender & settlement process"
      subtitle="How a short tenders, how longs are allocated, and how cash & warrants settle (ICE Clear Europe Part P)"
    >
      <P>
        When a Robusta Coffee (RC) futures position is carried into delivery, the exchange runs a defined
        <strong> tender → allocation → settlement</strong> procedure. This paper documents that flow from ICE Clear
        Europe&rsquo;s <strong>Delivery Procedures, Part P</strong> for the 10-tonne Robusta Coffee (Financials &amp;
        Softs Coffee) contract — how a short tenders coffee, how longs are allocated lots pro-rata, and how money and
        warehouse warrants change hands. The <em>quality, growth and allowance</em> detail is set by the contract Rules
        (RC Section GGGG — see <strong>Contract rules</strong>); this procedure governs the operational flow and defers
        all pricing adjustments to those Rules.
      </P>

      <H2>Two systems — and a tender is only valid in both</H2>
      <P>The whole flow runs through two systems:</P>
      <UL>
        <LI><strong><Code>UCP ECS</Code> / <Code>PTMS</Code></strong> — the clearing/settlement side: position
          maintenance, settlements and transfers.</LI>
        <LI><strong><Code>Guardian</Code></strong> — the delivery-management side: lot details, invoice reports, account
          sales, delivery details, and the final warrant transfer.</LI>
      </UL>
      <Highlight>
        A delivery notification submitted to <Code>UCP ECS</Code> <em>without</em> the corresponding lot detail in
        <Code> Guardian</Code> (or vice versa) does <strong>not</strong> constitute a valid Tender to the Clearing House.
        Both must be submitted; Clearing Members may delete tender notifications up to the deadline.
      </Highlight>

      <H2>Delivery specification (Part 1)</H2>
      <UL>
        <LI><strong>Quality</strong> — Robusta of a growth and quality specified in the LIFFE / ICE Futures Europe Rules.</LI>
        <LI><strong>Price</strong> — the <strong>Market Delivery Settlement Price (MDSP)</strong> on the Business Day
          <em> immediately preceding</em> the day of Tender, <em>adjusted in accordance with the Rules</em> — this is
          where the Section GGGG quality-class, age, weight, rent and import-duty allowances enter the invoice.</LI>
        <LI><strong>Scope</strong> — delivered from a <em>nominated warehouse</em> as defined in the Rules.</LI>
        <LI><strong>Cessation of trading</strong> — the delivery month ceases trading on the last trading day, which
          unless specified otherwise is <strong>~12:30 on the last Business Day of the delivery month</strong>. Sellers&rsquo;
          Tenders may be submitted <strong>by 12:00 on any Business Day of the Tender Period</strong>, except the last
          trading day (by <strong>14:30</strong>).</LI>
      </UL>

      <H2>The timeline</H2>
      <P>
        Delivery is not a single event: a short can tender on <em>any</em> Business Day of the delivery month, longs are
        allocated <strong>pro-rata</strong> in two rounds, and cash + warrants settle a fixed number of days later.
      </P>
      <Timeline
        rows={[
          {
            stage: "Tender Day", when: "by 12:00",
            what: <>Clearing Members perform <strong>position maintenance</strong>. A seller wishing to tender inputs a
              Delivery Notice via <em>both</em> <Code>UCP ECS</Code> and <Code>Guardian</Code> (lot details in Guardian).
              All settlements/transfers must be completed in <Code>UCP ECS/PTMS</Code> by 12:00. (Any Business Day of the
              delivery month except the last.)</>,
          },
          {
            stage: "First Allocation", when: "after 12:00",
            what: <>The <Code>MPFE</Code> report on <Code>UCP</Code> tells buyers how many lots they received. RC is
              allocated to buyers <strong>pro-rata</strong>. Buyers get an <em>invoice report</em> + delivery details;
              sellers get an <em>account-sale report</em> + delivery details (via Guardian).</>,
          },
          {
            stage: "Cessation / Last Tender Day", when: "12:30 · by 14:30",
            what: <>At <strong>12:30</strong> the delivery month <strong>ceases trading</strong>. By <strong>14:30</strong>,
              position maintenance is done and any remaining <strong>Open Contract Positions automatically become delivery
              obligations</strong>; sellers submit lot details via <Code>Guardian</Code> (<Code>UCP ECS</Code> not required
              this day). Assignments/settlements/transfers completed in <Code>UCP ECS/PTMS</Code> by 14:30. Members with
              open positions in the expired month must make or take delivery.</>,
          },
          {
            stage: "Second (final) Allocation", when: "after 14:30",
            what: <>The <Code>MPFE</Code> report gives buyers the <strong>final</strong> lot count; a second pro-rata
              allocation of RC. Account sales / invoices + delivery details issued via Guardian.</>,
          },
          {
            stage: "Settlement Day", when: "≈ Tender Day + 14 days *",
            what: <>By <strong>09:00</strong> the Clearing House <strong>debits buyers</strong> per the invoices; after
              09:00 it <strong>credits sellers</strong> per the account sales and <strong>transfers the warrants to
              buyers</strong> via <Code>Guardian</Code>. (Day-count amended — see below.)</>,
          },
          {
            stage: "Substitution of Tenders", when: "after Settlement Day, by 17:00 *",
            what: <>A seller may <strong>substitute</strong> a tender with the buyer&rsquo;s <em>prior consent</em> (or, in
              dispute, if ordered by LIFFE / ICE Futures Europe); Guardian notifies any price change and issues a
              substitution invoice/account sale. No consent → the original tender stands; seller failure to deliver →
              <strong> default in performance</strong>.</>,
          },
        ]}
      />
      <P className="text-[11px] text-slate-500">* See the amendments below — the source&rsquo;s exact day-counts for
        settlement and substitution are amended/ambiguous and should be verified against the current live procedures.</P>

      <H2>How allocation works</H2>
      <P>
        Allocation to buyers is <strong>pro-rata</strong> across open long positions — a buyer does not choose the seller
        or the specific lots; the Clearing House assigns them. There are two rounds: the <strong>First Allocation</strong>
        clears the intraday tenders after the 12:00 deadline, and the <strong>Second, final Allocation</strong> after
        14:30 on the last tender day sweeps up every remaining open position — which by then has <em>automatically</em>
        become a delivery obligation. So <strong>carrying an RC position past the last trading day is an automatic
        obligation to make or take delivery</strong>.
      </P>

      <H2>Settlement &amp; taking up the warrant</H2>
      <P>
        On <strong>Settlement Day</strong> money and title move together: the Clearing House debits each buyer by 09:00
        (per invoice), then after 09:00 credits each seller (per account sale) and <strong>transfers the warehouse
        warrants to the buyers</strong> through Guardian. The <strong>warrant is the document of title</strong> — taking
        it up is how the long takes possession of the coffee in the nominated warehouse. Because the price is the
        prior-day MDSP <em>adjusted by the contract allowances</em>, the invoice already embeds the quality-class, age,
        weight, rent and import-duty adjustments (Section GGGG).
      </P>

      <H2>Substitution &amp; default</H2>
      <P>
        Before the process fully closes, a seller can <strong>substitute</strong> the tendered lots for others — but only
        with the <strong>buyer&rsquo;s prior consent</strong> (or, in a dispute, if ordered by the exchange). Any
        resulting price difference is notified and re-invoiced via Guardian. If the buyer withholds consent the seller
        must deliver the original tender; failing that, the seller is <strong>in default in performance</strong>.
      </P>

      <H2>Amendments (July 2018 delivery months onwards)</H2>
      <P>The document carries dated footnotes; quoted verbatim:</P>
      <UL>
        <LI><strong>Early Take Up removed</strong> — &ldquo;<em>With effect from delivery months July 2018 onwards this
          &lsquo;Early Take Up&rsquo; section is deleted.</em>&rdquo; (Previously a buyer could take up warrants before
          the due Settlement Day by 16:00 the prior Business Day, receiving an Early Take Up Invoice / Account Sale.)</LI>
        <LI><strong>Settlement timing</strong> — the base text reads &ldquo;<em>14 days after the Tender Day</em>&rdquo;;
          the footnotes say &ldquo;<em>this shall instead read &lsquo;4 days&rsquo;</em>&rdquo; and &ldquo;<em>this title
          shall instead read &lsquo;14 Business Days after Tender Day&rsquo;</em>&rdquo;.</LI>
      </UL>
      <Highlight>
        The source&rsquo;s payment-timing footnotes <strong>overlap</strong> (&ldquo;14 days&rdquo; → &ldquo;4 days&rdquo;
        vs. a &ldquo;14 Business Days after Tender Day&rdquo; title), and the Substitution row shows an amended day-count
        (7 / 14 Business Days after Settlement Day). Treat the exact <em>day-counts</em> as needing verification against
        the current live Delivery Procedures — the <em>sequence and mechanism</em> above are as documented.
      </Highlight>

      <H2>Where it sits</H2>
      <P>
        This is <strong>Part P</strong> of the ICE Clear Europe Delivery Procedures for the 10-tonne Robusta Coffee
        (Financials &amp; Softs Coffee) contract. It governs the operational tender/allocation/settlement flow and defers
        all quality, growth and allowance detail to the contract Rules — documented in Research → <strong>Contract
        rules</strong> (RC Section GGGG: deliverable classes, the quality-class / age / weight / rent / import-duty
        allowances, and the EDSP × net-outturn-weight invoicing formula).
      </P>
    </Paper>
  );
}
