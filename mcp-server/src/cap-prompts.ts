/**
 * CAP CDS Prompt Definitions
 *
 * MCP Prompts are pre-built prompt templates that clients can offer to users.
 * When a user selects a prompt, the server expands it into a sequence of
 * messages (role + content) that guide the AI through a workflow.
 *
 * Prompts vs Tools vs Resources:
 *   - Tools:     AI calls them on demand (RPC)
 *   - Resources: Client reads data upfront (context)
 *   - Prompts:   User picks a workflow, server returns guiding messages
 *
 * We expose prompts for common SFLIGHT scenarios:
 *   - explore-data-model:   Understand the CDS schema and relationships
 *   - analyze-flights:      Flight analytics (occupancy, revenue, trends)
 *   - find-routes:          Search airline routes between cities
 *   - booking-report:       Booking analysis by class, agency, customer
 *   - airline-profile:      Deep dive into a specific airline
 *   - data-quality-check:   Audit data for gaps and anomalies
 */

// ─── Types ───────────────────────────────────────────────────

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: PromptArgument[];
  handler: (args: Record<string, string>) => PromptMessage[];
}

// ─── Prompt Definitions ──────────────────────────────────────

const exploreDataModel: PromptDefinition = {
  name: 'explore-data-model',
  description:
    'Understand the SFLIGHT CDS data model — entities, relationships, views, and how tables connect. ' +
    'Great starting point before writing queries.',
  handler: () => [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          'I want to understand the SFLIGHT data model. Please:\n\n' +
          '1. Use `cap_entities` to list all entities and views\n' +
          '2. Use `cap_nav_map` to show how tables relate via JOINs\n' +
          '3. Use `cap_data_stats` to show which tables have data and row counts\n' +
          '4. Summarize the key entity chains (Carriers → Connections → Flights → Bookings)\n' +
          '5. Highlight the 4 pre-joined views (FlightSchedule, BookingDetails, CarrierConnections, CustomerBusinessPartners) and when to use them vs raw tables\n\n' +
          'Present this as a clear data model overview I can reference later.',
      },
    },
  ],
};

const analyzeFlights: PromptDefinition = {
  name: 'analyze-flights',
  description:
    'Analyze flight data — occupancy rates, revenue, seat utilization, and trends across airlines and routes.',
  arguments: [
    {
      name: 'airline',
      description: 'Airline code to focus on (e.g., "LH", "AA", "SQ"). Leave empty for all airlines.',
    },
    {
      name: 'year',
      description: 'Year to focus on (e.g., "2025"). Leave empty for all years.',
    },
  ],
  handler: (args) => {
    const airlineFilter = args.airline
      ? `Focus specifically on airline "${args.airline}". `
      : 'Cover all airlines. ';
    const yearFilter = args.year
      ? `Focus on year ${args.year}. `
      : 'Cover all available years. ';

    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Analyze the flight data in this SFLIGHT database. ${airlineFilter}${yearFilter}\n\n` +
            'Please provide:\n' +
            '1. **Occupancy Analysis**: Average seat occupancy rate (SEATSOCC/SEATSMAX) by airline — use `cap_cql_query` with a JOIN between flights and carriers\n' +
            '2. **Revenue Overview**: Total PAYMENTSUM by airline, sorted highest first\n' +
            '3. **Route Performance**: Top 10 routes by number of flights (use Connections for CITYFROM/CITYTO)\n' +
            '4. **Year-over-Year Trend**: Use `cap_yoy_growth` to show flight count trends\n' +
            '5. **Business/First Class**: Compare SEATSOCC_B and SEATSOCC_F across airlines\n\n' +
            'Use the pre-joined `flights_FlightSchedule` view where possible to avoid manual JOINs. ' +
            'Present results with clear tables and key takeaways.',
        },
      },
    ];
  },
};

const findRoutes: PromptDefinition = {
  name: 'find-routes',
  description:
    'Find airline routes between cities — which airlines fly where, departure/arrival times, distances.',
  arguments: [
    {
      name: 'from',
      description: 'Departure city (e.g., "NEW YORK", "FRANKFURT", "TOKYO")',
    },
    {
      name: 'to',
      description: 'Arrival city (e.g., "LONDON", "SINGAPORE", "SAN FRANCISCO")',
    },
  ],
  handler: (args) => {
    let query = 'Find airline routes';
    const conditions: string[] = [];

    if (args.from) conditions.push(`departing from "${args.from}"`);
    if (args.to) conditions.push(`arriving at "${args.to}"`);

    if (conditions.length > 0) {
      query += ' ' + conditions.join(' and ');
    } else {
      query += ' across the entire network';
    }

    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `${query}.\n\n` +
            'Please:\n' +
            '1. Query `flights_Connections` to find matching routes (CITYFROM, CITYTO, CARRID, CONNID)\n' +
            '2. Join with `flights_Carriers` to show airline names\n' +
            '3. Include departure time (DEPTIME), arrival time (ARRTIME), flight time (FLTIME), and distance (DISTANCE)\n' +
            '4. For each route found, check `flights_Flights` for available flight dates and typical prices\n' +
            '5. Show airport codes (AIRPFROM, AIRPTO) and look up airport names from `flights_Airports`\n\n' +
            'Present as a route comparison table. If no exact matches, suggest nearby routes or connecting options.',
        },
      },
    ];
  },
};

const bookingReport: PromptDefinition = {
  name: 'booking-report',
  description:
    'Generate a booking analysis report — by travel class, travel agency, customer segments, and cancellation rates.',
  arguments: [
    {
      name: 'dimension',
      description: 'Analysis dimension: "class" (travel class), "agency" (travel agency), "customer" (customer type), or "all" (default)',
    },
  ],
  handler: (args) => {
    const dimension = args.dimension || 'all';

    let focusInstruction = '';
    switch (dimension) {
      case 'class':
        focusInstruction = 'Focus the analysis on travel class breakdown (Economy/Business/First using the CLASS field).';
        break;
      case 'agency':
        focusInstruction = 'Focus on travel agency performance — which agencies generate the most bookings and revenue.';
        break;
      case 'customer':
        focusInstruction = 'Focus on customer segments — CUSTTYPE distribution, top customers by booking count, discount patterns.';
        break;
      default:
        focusInstruction = 'Cover all dimensions: class, agency, and customer analysis.';
    }

    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Generate a booking analysis report for the SFLIGHT database. ${focusInstruction}\n\n` +
            'Please provide:\n' +
            '1. **Booking Volume**: Total bookings, use `cap_data_distribution` on Bookings by CLASS\n' +
            '2. **Revenue by Class**: SUM(FORCURAM) grouped by CLASS from `flights_Bookings`\n' +
            '3. **Cancellation Rate**: Count of CANCELLED bookings vs total\n' +
            '4. **Top Travel Agencies**: Join Bookings with `flights_TravelAgencies` on AGENCYNUM, rank by booking count\n' +
            '5. **Customer Analysis**: Distribution by CUSTTYPE, top customers by booking frequency\n' +
            '6. **Booking Trends**: Use `cap_yoy_growth` on Bookings to show year-over-year trends\n' +
            '7. **Average Booking Value**: AVG(FORCURAM) by class and currency\n\n' +
            'Use the pre-joined `flights_BookingDetails` view where helpful. ' +
            'Present with summary tables and highlight any notable patterns.',
        },
      },
    ];
  },
};

const airlineProfile: PromptDefinition = {
  name: 'airline-profile',
  description:
    'Deep dive into a specific airline — fleet, routes, flights, bookings, meals, and financial performance.',
  arguments: [
    {
      name: 'airline',
      description: 'Airline code (e.g., "LH" for Lufthansa, "AA" for American Airlines, "SQ" for Singapore Airlines)',
      required: true,
    },
  ],
  handler: (args) => {
    const airline = args.airline || 'LH';

    return [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Build a comprehensive profile for airline "${airline}".\n\n` +
            'Please gather and present:\n' +
            `1. **Airline Info**: Query \`flights_Carriers\` for CARRNAME, CURRCODE, URL where CARRID = '${airline}'\n` +
            `2. **Fleet**: Join \`flights_CarrierPlanes\` with \`flights_Planes\` to show aircraft types operated, seat capacities, and producers\n` +
            `3. **Route Network**: Query \`flights_Connections\` for all routes — CITYFROM → CITYTO, distances, flight times\n` +
            `4. **Flight Volume**: Count flights by year from \`flights_Flights\` where CARRID = '${airline}'\n` +
            `5. **Occupancy**: Average SEATSOCC/SEATSMAX across all flights — economy, business, first class separately\n` +
            `6. **Revenue**: Total PAYMENTSUM and average PRICE per flight\n` +
            `7. **Bookings**: Count from \`flights_Bookings\`, breakdown by CLASS (C/Y/F), cancellation rate\n` +
            `8. **Meal Service**: Check \`flights_Meals\` and \`flights_Menus\` for what this airline serves\n\n` +
            'Present as a structured airline dossier with sections and summary tables.',
        },
      },
    ];
  },
};

const dataQualityCheck: PromptDefinition = {
  name: 'data-quality-check',
  description:
    'Audit the SFLIGHT data for quality — check for gaps, orphan records, NULL values, and anomalies.',
  handler: () => [
    {
      role: 'user',
      content: {
        type: 'text',
        text:
          'Run a data quality audit on the SFLIGHT database.\n\n' +
          'Please check:\n' +
          '1. **Row Counts**: Use `cap_data_stats` to see which entities have data and which are empty\n' +
          '2. **Orphan Records**: Check if any Bookings reference non-existent Flights (JOIN mismatch)\n' +
          '3. **Referential Integrity**: Check Connections → Carriers (does every CARRID in Connections exist in Carriers?)\n' +
          '4. **NULL Analysis**: For key tables (Flights, Bookings, Customers), check for NULL values in important columns like PRICE, SEATSOCC, CUSTOMID\n' +
          '5. **Date Range**: What date range does the flight data cover? Any gaps in coverage?\n' +
          '6. **Duplicate Check**: Any duplicate bookings (same CARRID+CONNID+FLDATE+BOOKID)?\n' +
          '7. **Value Ranges**: Are there any flights with SEATSOCC > SEATSMAX (overbooking)? Negative prices?\n' +
          '8. **Empty Tables**: Which entities have 0 rows and might need seed data?\n\n' +
          'Summarize findings as a data quality scorecard with pass/fail for each check.',
      },
    },
  ],
};

// ─── Export ──────────────────────────────────────────────────

export const ALL_PROMPTS: PromptDefinition[] = [
  exploreDataModel,
  analyzeFlights,
  findRoutes,
  bookingReport,
  airlineProfile,
  dataQualityCheck,
];
