using flights from '../db/schema';

// @open: temporarily allows unauthenticated access (no BTP role assignment needed).
// Remove this annotation when admin can assign sflights-mcp-viewer to users.
@open
service FlightsService @(path: '/odata/v4/flights') {

        // ─── Airlines & Fleet ────────────────────────────────
        @mcp: {
                name       : 'carriers',
                description: 'Airlines with fleet and route information',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top',
                        'expand'
                ]
        }
        @cds.redirection.target
        @readonly
        entity Carriers                 as projection on flights.Carriers;

        @mcp: {
                name       : 'carrier-planes',
                description: 'Fleet assignments — which planes each airline operates',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top'
                ]
        }
        @readonly
        entity CarrierPlanes            as projection on flights.CarrierPlanes;

        entity Planes                   as projection on flights.Planes;
        entity CargoPlanes              as projection on flights.CargoPlanes;
        entity PassengerPlanes          as projection on flights.PassengerPlanes;

        // ─── Connections & Flights ───────────────────────────
        @mcp: {
                name       : 'connections',
                description: 'Flight routes between cities with distance and schedule',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top',
                        'expand'
                ]
        }
        @readonly
        entity Connections              as projection on flights.Connections;

        @mcp: {
                name       : 'flights',
                description: 'Flight schedules with pricing, seat occupancy, and capacity',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top',
                        'expand'
                ]
        }
        @cds.redirection.target
        @readonly
        entity Flights                  as projection on flights.Flights;

        // ─── Bookings ────────────────────────────────────────
        @mcp: {
                name       : 'bookings',
                description: 'Passenger bookings with customer and flight details',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top',
                        'expand'
                ]
        }
        @cds.redirection.target
        @readonly
        entity Bookings                 as projection on flights.Bookings;

        @readonly
        entity Tickets                  as projection on flights.Tickets;

        @readonly
        entity Invoices                 as projection on flights.Invoices;

        // ─── Customers & Business Partners ──────────────────
        @mcp: {
                name       : 'customers',
                description: 'Customer profiles with type (business/private) and location',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top',
                        'expand'
                ]
        }
        @cds.redirection.target
        @readonly
        entity Customers                as projection on flights.Customers;

        @readonly
        entity BusinessPartners         as projection on flights.BusinessPartners;

        // ─── Travel Agencies ─────────────────────────────────
        @mcp: {
                name       : 'travel-agencies',
                description: 'Travel agencies that book flights',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top'
                ]
        }
        @readonly
        entity TravelAgencies           as projection on flights.TravelAgencies;

        @readonly
        entity Counters                 as projection on flights.Counters;

        // ─── Airports & Geography ───────────────────────────
        @mcp: {
                name       : 'airports',
                description: 'Airport codes, names, and time zones',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top'
                ]
        }
        @readonly
        entity Airports                 as projection on flights.Airports;

        @readonly
        entity CityAirports             as projection on flights.CityAirports;

        @readonly
        entity GeoCities                as projection on flights.GeoCities;

        // ─── In-flight Meals ─────────────────────────────────
        @readonly
        entity Meals                    as projection on flights.Meals;

        @readonly
        entity MealTexts                as projection on flights.MealTexts;

        @readonly
        entity Menus                    as projection on flights.Menus;

        @readonly
        entity FlightMeals              as projection on flights.FlightMeals;

        @readonly
        entity Starters                 as projection on flights.Starters;

        @readonly
        entity MainCourses              as projection on flights.MainCourses;

        @readonly
        entity Desserts                 as projection on flights.Desserts;

        // ─── Currency ────────────────────────────────────────
        @readonly
        entity CurrencyRates            as projection on flights.CurrencyRates;

        @readonly
        entity CurrencyDecimals         as projection on flights.CurrencyDecimals;

        // ─── Views ───────────────────────────────────────────
        @readonly
        entity CustomerBusinessPartners as projection on flights.CustomerBusinessPartners;

        @readonly
        entity CarrierConnections       as projection on flights.CarrierConnections;

        @mcp: {
                name       : 'flight-schedule',
                description: 'Denormalized view: flights with carrier and route info',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top'
                ]
        }
        @readonly
        entity FlightSchedule           as projection on flights.FlightSchedule;

        @mcp: {
                name       : 'booking-details',
                description: 'Denormalized view: bookings with flight, route, and customer data',
                resource   : [
                        'filter',
                        'orderby',
                        'select',
                        'top'
                ]
        }
        @readonly
        entity BookingDetails           as projection on flights.BookingDetails;

        // ─── Functions ───────────────────────────────────────
        @mcp: {
                name       : 'get-flights-on-date',
                description: 'Get all flight connections operating on a specific date',
                tool       : true
        }
        function getFlightsOnDate(flightDate: Date) returns array of CarrierConnections;
}

// ─── MCP Prompts ────────────────────────────────────────────
annotate FlightsService with @mcp.prompts: [
        {
                name       : 'airline-overview',
                title      : 'Airline Overview',
                description: 'Get a comprehensive overview of a specific airline including routes, fleet, and seat occupancy',
                template   : 'Give me a comprehensive overview of the airline with carrier ID {{carrier_id}}. Include its routes, fleet composition, number of flights, and average seat occupancy.',
                role       : 'user',
                inputs     : [{ key: 'carrier_id', type: 'String' }]
        },
        {
                name       : 'route-finder',
                title      : 'Route Finder',
                description: 'Find available flight routes between two cities',
                template   : 'Find all available flight routes from {{city_from}} to {{city_to}}. Show the airlines operating each route, flight frequency, typical pricing, and seat availability.',
                role       : 'user',
                inputs     : [
                        { key: 'city_from', type: 'String' },
                        { key: 'city_to',   type: 'String' }
                ]
        },
        {
                name       : 'booking-analysis',
                title      : 'Booking Analysis',
                description: 'Analyze booking patterns and trends for a given airline or route',
                template   : 'Analyze the booking patterns for {{subject}}. Show booking volumes, class distribution (economy, business, first), popular routes, and customer demographics.',
                role       : 'user',
                inputs     : [{ key: 'subject', type: 'String' }]
        }
];
