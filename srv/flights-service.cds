using flights from '../db/schema';

service FlightsService @(path: '/odata/v4/flights') {

    // ─── Airlines & Fleet ────────────────────────────────
    @mcp: { name: 'carriers', description: 'Airlines with fleet and route information',
            resource: ['filter', 'orderby', 'select', 'top', 'expand'] }
    @cds.redirection.target
    entity Carriers         as projection on flights.Carriers;

    @mcp: { name: 'carrier-planes', description: 'Fleet assignments — which planes each airline operates',
            resource: ['filter', 'orderby', 'select', 'top'] }
    entity CarrierPlanes    as projection on flights.CarrierPlanes;

    entity Planes           as projection on flights.Planes;
    entity CargoPlanes      as projection on flights.CargoPlanes;
    entity PassengerPlanes  as projection on flights.PassengerPlanes;

    // ─── Connections & Flights ───────────────────────────
    @mcp: { name: 'connections', description: 'Flight routes between cities with distance and schedule',
            resource: ['filter', 'orderby', 'select', 'top', 'expand'] }
    entity Connections      as projection on flights.Connections;

    @mcp: { name: 'flights', description: 'Flight schedules with pricing, seat occupancy, and capacity',
            resource: ['filter', 'orderby', 'select', 'top', 'expand'] }
    @cds.redirection.target
    entity Flights          as projection on flights.Flights;

    // ─── Bookings ────────────────────────────────────────
    @mcp: { name: 'bookings', description: 'Passenger bookings with customer and flight details',
            resource: ['filter', 'orderby', 'select', 'top', 'expand'] }
    @cds.redirection.target
    entity Bookings         as projection on flights.Bookings;
    entity Tickets          as projection on flights.Tickets;
    entity Invoices         as projection on flights.Invoices;

    // ─── Customers & Business Partners ──────────────────
    @mcp: { name: 'customers', description: 'Customer profiles with type (business/private) and location',
            resource: ['filter', 'orderby', 'select', 'top', 'expand'] }
    @cds.redirection.target
    entity Customers        as projection on flights.Customers;
    entity BusinessPartners as projection on flights.BusinessPartners;

    // ─── Travel Agencies ─────────────────────────────────
    @mcp: { name: 'travel-agencies', description: 'Travel agencies that book flights',
            resource: ['filter', 'orderby', 'select', 'top'] }
    entity TravelAgencies   as projection on flights.TravelAgencies;
    entity Counters         as projection on flights.Counters;

    // ─── Airports & Geography ───────────────────────────
    @mcp: { name: 'airports', description: 'Airport codes, names, and time zones',
            resource: ['filter', 'orderby', 'select', 'top'] }
    entity Airports         as projection on flights.Airports;
    entity CityAirports     as projection on flights.CityAirports;
    entity GeoCities        as projection on flights.GeoCities;

    // ─── In-flight Meals ─────────────────────────────────
    entity Meals            as projection on flights.Meals;
    entity MealTexts        as projection on flights.MealTexts;
    entity Menus            as projection on flights.Menus;
    entity FlightMeals      as projection on flights.FlightMeals;
    entity Starters         as projection on flights.Starters;
    entity MainCourses      as projection on flights.MainCourses;
    entity Desserts         as projection on flights.Desserts;

    // ─── Currency ────────────────────────────────────────
    entity CurrencyRates    as projection on flights.CurrencyRates;
    entity CurrencyDecimals as projection on flights.CurrencyDecimals;

    // ─── Views ───────────────────────────────────────────
    @readonly entity CustomerBusinessPartners as projection on flights.CustomerBusinessPartners;
    @readonly entity CarrierConnections       as projection on flights.CarrierConnections;

    @mcp: { name: 'flight-schedule', description: 'Denormalized view: flights with carrier and route info',
            resource: ['filter', 'orderby', 'select', 'top'] }
    @readonly entity FlightSchedule           as projection on flights.FlightSchedule;

    @mcp: { name: 'booking-details', description: 'Denormalized view: bookings with flight, route, and customer data',
            resource: ['filter', 'orderby', 'select', 'top'] }
    @readonly entity BookingDetails           as projection on flights.BookingDetails;

    // ─── Functions ───────────────────────────────────────
    function getFlightsOnDate(flightDate : Date) returns array of CarrierConnections;
}
