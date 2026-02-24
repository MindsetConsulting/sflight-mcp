namespace flights;

// ─── Airlines & Fleet ────────────────────────────────────────

entity Carriers {
    key MANDT       : String(3);
    key CARRID      : String(3);
        CARRNAME    : String(20);
        CURRCODE    : String(5);
        URL         : String(255);
        // Compositions (owned children)
        FLEET       : Composition of many CarrierPlanes
                          on  FLEET.MANDT  = MANDT
                          and FLEET.CARRID = CARRID;
        COUNTERS    : Composition of many Counters
                          on  COUNTERS.MANDT  = MANDT
                          and COUNTERS.CARRID = CARRID;
        // Associations (navigational)
        CONNECTIONS : Association to many Connections
                          on  CONNECTIONS.MANDT  = MANDT
                          and CONNECTIONS.CARRID = CARRID;
        FLIGHTS     : Association to many Flights
                          on  FLIGHTS.MANDT  = MANDT
                          and FLIGHTS.CARRID = CARRID;
        MEALS       : Association to many Meals
                          on  MEALS.MANDT  = MANDT
                          and MEALS.CARRID = CARRID;
        MENUS       : Association to many Menus
                          on  MENUS.MANDT  = MANDT
                          and MENUS.CARRID = CARRID;
}

entity CarrierPlanes {
    key MANDT     : String(3);
    key CARRID    : String(3);
    key PLANETYPE : String(10);
        SNUMBER   : Decimal(6, 0);
        // Associations
        CARRIER   : Association to Carriers
                        on  CARRIER.MANDT  = MANDT
                        and CARRIER.CARRID = CARRID;
        PLANE     : Association to Planes
                        on  PLANE.MANDT     = MANDT
                        and PLANE.PLANETYPE = PLANETYPE;
}

entity Planes {
    key MANDT         : String(3);
    key PLANETYPE     : String(10);
        SEATSMAX      : Integer not null;
        CONSUM        : Double;
        CON_UNIT      : String(3);
        TANKCAP       : Decimal(16, 4);
        CAP_UNIT      : String(3);
        WEIGHT        : Decimal(14, 4);
        WEI_UNIT      : String(3);
        SPAN          : Double;
        SPAN_UNIT     : String(3);
        LENG          : Double;
        LENG_UNIT     : String(3);
        OP_SPEED      : Decimal(17, 4);
        SPEED_UNIT    : String(3);
        PRODUCER      : String(5);
        SEATSMAX_B    : Integer;
        SEATSMAX_F    : Integer;
        // Associations
        CARRIER_FLEET : Association to many CarrierPlanes
                            on  CARRIER_FLEET.MANDT     = MANDT
                            and CARRIER_FLEET.PLANETYPE = PLANETYPE;
        CARGO         : Association to CargoPlanes
                            on  CARGO.MANDT     = MANDT
                            and CARGO.PLANETYPE = PLANETYPE;
        PASSENGER     : Association to PassengerPlanes
                            on  PASSENGER.MANDT     = MANDT
                            and PASSENGER.PLANETYPE = PLANETYPE;
}

entity CargoPlanes {
    key MANDT     : String(3);
    key PLANETYPE : String(10);
        CARGOMAX  : Decimal(16, 4);
        CAR_UNIT  : String(3) not null;
        // Associations
        PLANE     : Association to Planes
                        on  PLANE.MANDT     = MANDT
                        and PLANE.PLANETYPE = PLANETYPE;
}

entity PassengerPlanes {
    key MANDT      : String(3);
    key PLANETYPE  : String(10);
        ANZ_NOTAUS : Integer;
        ANZ_PERS   : Integer;
        ANZ_SBER   : Integer;
        // Associations
        PLANE      : Association to Planes
                         on  PLANE.MANDT     = MANDT
                         and PLANE.PLANETYPE = PLANETYPE;
}

// ─── Connections & Flights ───────────────────────────────────

entity Connections {
    key MANDT        : String(3);
    key CARRID       : String(3);
    key CONNID       : String(4);
        COUNTRYFR    : String(3);
        CITYFROM     : String(20);
        AIRPFROM     : String(3);
        COUNTRYTO    : String(3);
        CITYTO       : String(20);
        AIRPTO       : String(3);
        FLTIME       : Integer;
        DEPTIME      : Time;
        ARRTIME      : Time;
        DISTANCE     : Decimal(9, 4);
        DISTID       : String(3);
        FLTYPE       : String(1);
        PERIOD       : Integer;
        // Associations
        CARRIER      : Association to Carriers
                           on  CARRIER.MANDT  = MANDT
                           and CARRIER.CARRID = CARRID;
        FLIGHTS      : Association to many Flights
                           on  FLIGHTS.MANDT  = MANDT
                           and FLIGHTS.CARRID = CARRID
                           and FLIGHTS.CONNID = CONNID;
        AIRPORT_FROM : Association to Airports
                           on  AIRPORT_FROM.MANDT = MANDT
                           and AIRPORT_FROM.ID    = AIRPFROM;
        AIRPORT_TO   : Association to Airports
                           on  AIRPORT_TO.MANDT = MANDT
                           and AIRPORT_TO.ID    = AIRPTO;
        CITY_FROM    : Association to GeoCities
                           on  CITY_FROM.MANDT   = MANDT
                           and CITY_FROM.CITY    = CITYFROM
                           and CITY_FROM.COUNTRY = COUNTRYFR;
        CITY_TO      : Association to GeoCities
                           on  CITY_TO.MANDT   = MANDT
                           and CITY_TO.CITY    = CITYTO
                           and CITY_TO.COUNTRY = COUNTRYTO;
        FLIGHT_MEALS : Association to many FlightMeals
                           on  FLIGHT_MEALS.MANDT  = MANDT
                           and FLIGHT_MEALS.CARRID = CARRID
                           and FLIGHT_MEALS.CONNID = CONNID;
}

entity Flights {
    key MANDT      : String(3);
    key CARRID     : String(3);
    key CONNID     : String(4);
    key FLDATE     : Date;
        PRICE      : Decimal(15, 2);
        CURRENCY   : String(5);
        PLANETYPE  : String(10);
        SEATSMAX   : Integer;
        SEATSOCC   : Integer;
        PAYMENTSUM : Decimal(17, 2);
        SEATSMAX_B : Integer;
        SEATSOCC_B : Integer;
        SEATSMAX_F : Integer;
        SEATSOCC_F : Integer;
        // Associations
        CARRIER    : Association to Carriers
                         on  CARRIER.MANDT  = MANDT
                         and CARRIER.CARRID = CARRID;
        CONNECTION : Association to Connections
                         on  CONNECTION.MANDT  = MANDT
                         and CONNECTION.CARRID = CARRID
                         and CONNECTION.CONNID = CONNID;
        PLANE      : Association to Planes
                         on  PLANE.MANDT     = MANDT
                         and PLANE.PLANETYPE = PLANETYPE;
        BOOKINGS   : Association to many Bookings
                         on  BOOKINGS.MANDT  = MANDT
                         and BOOKINGS.CARRID = CARRID
                         and BOOKINGS.CONNID = CONNID
                         and BOOKINGS.FLDATE = FLDATE;
}

// ─── Bookings ────────────────────────────────────────────────

entity Bookings {
    key MANDT      : String(3);
    key CARRID     : String(3);
    key CONNID     : String(4);
    key FLDATE     : Date;
    key BOOKID     : String(8);
        CUSTOMID   : String(8);
        CUSTTYPE   : String(1);
        SMOKER     : String(1);
        LUGGWEIGHT : Decimal(8, 4);
        WUNIT      : String(3);
        INVOICE    : String(1);
        CLASS      : String(1);
        FORCURAM   : Decimal(15, 2);
        FORCURKEY  : String(5);
        LOCCURAM   : Decimal(15, 2);
        LOCCURKEY  : String(5);
        ORDER_DATE : Date;
        COUNTER    : String(8);
        AGENCYNUM  : String(8);
        CANCELLED  : String(1);
        RESERVED   : String(1);
        PASSNAME   : String(25);
        PASSFORM   : String(15);
        PASSBIRTH  : String(8);
        // Associations
        FLIGHT     : Association to Flights
                         on  FLIGHT.MANDT  = MANDT
                         and FLIGHT.CARRID = CARRID
                         and FLIGHT.CONNID = CONNID
                         and FLIGHT.FLDATE = FLDATE;
        CUSTOMER   : Association to Customers
                         on  CUSTOMER.MANDT = MANDT
                         and CUSTOMER.ID    = CUSTOMID;
        AGENCY     : Association to TravelAgencies
                         on  AGENCY.MANDT     = MANDT
                         and AGENCY.AGENCYNUM = AGENCYNUM;
        // Compositions (owned children)
        TICKETS    : Composition of many Tickets
                         on  TICKETS.MANDT  = MANDT
                         and TICKETS.CARRID = CARRID
                         and TICKETS.CONNID = CONNID
                         and TICKETS.FLDATE = FLDATE
                         and TICKETS.BOOKID = BOOKID;
        INVOICES   : Composition of many Invoices
                         on  INVOICES.MANDT  = MANDT
                         and INVOICES.CARRID = CARRID
                         and INVOICES.CONNID = CONNID
                         and INVOICES.FLDATE = FLDATE
                         and INVOICES.BOOKID = BOOKID;
}

entity Tickets {
    key MANDT    : String(3);
    key CARRID   : String(3);
    key CONNID   : String(4);
    key FLDATE   : Date;
    key BOOKID   : String(8);
    key CUSTOMID : String(8);
    key TICKET   : String(1);
        PLACE    : String(40);
        ARCHIVE_ : String(4);
        // Associations
        BOOKING  : Association to Bookings
                       on  BOOKING.MANDT  = MANDT
                       and BOOKING.CARRID = CARRID
                       and BOOKING.CONNID = CONNID
                       and BOOKING.FLDATE = FLDATE
                       and BOOKING.BOOKID = BOOKID;
        CUSTOMER : Association to Customers
                       on  CUSTOMER.MANDT = MANDT
                       and CUSTOMER.ID    = CUSTOMID;
}

entity Invoices {
    key MANDT    : String(3);
    key CARRID   : String(3);
    key CONNID   : String(4);
    key FLDATE   : Date;
    key BOOKID   : String(8);
    key CUSTOMID : String(8);
    key INSTNO   : String(4);
        PAYMETH  : String(1);
        AMOUNT   : Decimal(15, 2);
        CURRENCY : String(5);
        ARCHIVE_ : String(4);
        // Associations
        BOOKING  : Association to Bookings
                       on  BOOKING.MANDT  = MANDT
                       and BOOKING.CARRID = CARRID
                       and BOOKING.CONNID = CONNID
                       and BOOKING.FLDATE = FLDATE
                       and BOOKING.BOOKID = BOOKID;
        CUSTOMER : Association to Customers
                       on  CUSTOMER.MANDT = MANDT
                       and CUSTOMER.ID    = CUSTOMID;
}

// ─── Customers & Business Partners ──────────────────────────

entity Customers {
    key MANDT           : String(3);
    key ID              : String(8);
        NAME            : String(25);
        FORM            : String(15);
        STREET          : String(30);
        POSTBOX         : String(10);
        POSTCODE        : String(10);
        CITY            : String(25);
        COUNTRY         : String(3);
        REGION          : String(3);
        TELEPHONE       : String(30);
        CUSTTYPE        : String(1);
        DISCOUNT        : String(3);
        LANGU           : String(1);
        EMAIL           : String(40);
        WEBUSER         : String(25);
        // Associations
        BUSINESSPARTNER : Association to BusinessPartners
                              on  BUSINESSPARTNER.MANDT      = MANDT
                              and BUSINESSPARTNER.BUSPARTNUM = ID;
        BOOKINGS        : Association to many Bookings
                              on  BOOKINGS.MANDT    = MANDT
                              and BOOKINGS.CUSTOMID = ID;
}

entity BusinessPartners {
    key MANDT      : String(3);
    key BUSPARTNUM : String(8);
        CONTACT    : String(25);
        CONTPHONO  : String(30);
        BUSPATYP   : String(2);
        // Associations
        CUSTOMER   : Association to Customers
                         on  CUSTOMER.MANDT = MANDT
                         and CUSTOMER.ID    = BUSPARTNUM;
}

// ─── Travel Agencies ─────────────────────────────────────────

entity TravelAgencies {
    key MANDT     : String(3);
    key AGENCYNUM : String(8);
        NAME      : String(25);
        STREET    : String(30);
        POSTBOX   : String(10);
        POSTCODE  : String(10);
        CITY      : String(25);
        COUNTRY   : String(3);
        REGION    : String(3);
        TELEPHONE : String(30);
        URL       : String(255);
        LANGU     : String(1);
        CURRENCY  : String(5);
        // Associations
        BOOKINGS  : Association to many Bookings
                        on  BOOKINGS.MANDT     = MANDT
                        and BOOKINGS.AGENCYNUM = AGENCYNUM;
}

entity Counters {
    key MANDT    : String(3);
    key CARRID   : String(3);
    key COUNTNUM : String(8);
        AIRPORT  : String(3);
        // Associations
        CARRIER  : Association to Carriers
                       on  CARRIER.MANDT  = MANDT
                       and CARRIER.CARRID = CARRID;
        AIRPORT_ : Association to Airports
                       on  AIRPORT_.MANDT = MANDT
                       and AIRPORT_.ID    = AIRPORT;
}

// ─── Airports & Geography ───────────────────────────────────

entity Airports {
    key MANDT         : String(3);
    key ID            : String(3);
        NAME          : String(25);
        TIME_ZONE     : String(6) not null;
        // Associations
        CITY_AIRPORTS : Association to many CityAirports
                            on  CITY_AIRPORTS.MANDT   = MANDT
                            and CITY_AIRPORTS.AIRPORT = ID;
}

entity CityAirports {
    key MANDT      : String(3);
    key CITY       : String(20);
    key COUNTRY    : String(3);
    key AIRPORT    : String(3);
        MASTERCITY : String(20);
        // Associations
        AIRPORT_   : Association to Airports
                         on  AIRPORT_.MANDT = MANDT
                         and AIRPORT_.ID    = AIRPORT;
        GEO        : Association to GeoCities
                         on  GEO.MANDT   = MANDT
                         and GEO.CITY    = CITY
                         and GEO.COUNTRY = COUNTRY;
}

entity GeoCities {
    key MANDT         : String(3);
    key CITY          : String(20);
    key COUNTRY       : String(3);
        LATITUDE      : Decimal(12, 6);
        LONGITUDE     : Decimal(12, 6);
        // Associations
        CITY_AIRPORTS : Association to many CityAirports
                            on  CITY_AIRPORTS.MANDT   = MANDT
                            and CITY_AIRPORTS.CITY    = CITY
                            and CITY_AIRPORTS.COUNTRY = COUNTRY;
}

// ─── In-flight Meals ─────────────────────────────────────────

entity Meals {
    key MANDT        : String(3);
    key CARRID       : String(3);
    key MEALNUMBER   : String(8);
        MEALTYPE     : String(2);
        // Associations
        CARRIER      : Association to Carriers
                           on  CARRIER.MANDT  = MANDT
                           and CARRIER.CARRID = CARRID;
        FLIGHT_MEALS : Association to many FlightMeals
                           on  FLIGHT_MEALS.MANDT      = MANDT
                           and FLIGHT_MEALS.CARRID     = CARRID
                           and FLIGHT_MEALS.MEALNUMBER = MEALNUMBER;
        STARTER      : Association to Starters
                           on  STARTER.MANDT      = MANDT
                           and STARTER.CARRID     = CARRID
                           and STARTER.MEALNUMBER = MEALNUMBER;
        MAIN_COURSE  : Association to MainCourses
                           on  MAIN_COURSE.MANDT      = MANDT
                           and MAIN_COURSE.CARRID     = CARRID
                           and MAIN_COURSE.MEALNUMBER = MEALNUMBER;
        DESSERT_     : Association to Desserts
                           on  DESSERT_.MANDT      = MANDT
                           and DESSERT_.CARRID     = CARRID
                           and DESSERT_.MEALNUMBER = MEALNUMBER;
        // Composition (owned children)
        TEXTS        : Composition of many MealTexts
                           on  TEXTS.MANDT      = MANDT
                           and TEXTS.CARRID     = CARRID
                           and TEXTS.MEALNUMBER = MEALNUMBER;
}

entity MealTexts {
    key MANDT      : String(3);
    key CARRID     : String(3);
    key MEALNUMBER : String(8);
    key LANG       : String(1);
        TEXT       : String(40);
        // Associations
        MEAL       : Association to Meals
                         on  MEAL.MANDT      = MANDT
                         and MEAL.CARRID     = CARRID
                         and MEAL.MEALNUMBER = MEALNUMBER;
}

entity Menus {
    key MANDT        : String(3);
    key CARRID       : String(3);
    key MENUNUMBER   : String(4);
        STARTER      : String(8);
        MAINCOURSE   : String(8);
        DESSERT      : String(8);
        // Associations
        CARRIER      : Association to Carriers
                           on  CARRIER.MANDT  = MANDT
                           and CARRIER.CARRID = CARRID;
        STARTER_MEAL : Association to Meals
                           on  STARTER_MEAL.MANDT      = MANDT
                           and STARTER_MEAL.CARRID     = CARRID
                           and STARTER_MEAL.MEALNUMBER = STARTER;
        MAIN_MEAL    : Association to Meals
                           on  MAIN_MEAL.MANDT      = MANDT
                           and MAIN_MEAL.CARRID     = CARRID
                           and MAIN_MEAL.MEALNUMBER = MAINCOURSE;
        DESSERT_MEAL : Association to Meals
                           on  DESSERT_MEAL.MANDT      = MANDT
                           and DESSERT_MEAL.CARRID     = CARRID
                           and DESSERT_MEAL.MEALNUMBER = DESSERT;
}

entity FlightMeals {
    key MANDT      : String(3);
    key CARRID     : String(3);
    key MEALNUMBER : String(8);
    key CONNID     : String(4);
        // Associations
        MEAL       : Association to Meals
                         on  MEAL.MANDT      = MANDT
                         and MEAL.CARRID     = CARRID
                         and MEAL.MEALNUMBER = MEALNUMBER;
        CONNECTION : Association to Connections
                         on  CONNECTION.MANDT  = MANDT
                         and CONNECTION.CARRID = CARRID
                         and CONNECTION.CONNID = CONNID;
}

entity Starters {
    key MANDT      : String(3);
    key CARRID     : String(3);
    key MEALNUMBER : String(8);
        HOT        : String(1);
        // Associations
        MEAL       : Association to Meals
                         on  MEAL.MANDT      = MANDT
                         and MEAL.CARRID     = CARRID
                         and MEAL.MEALNUMBER = MEALNUMBER;
}

entity MainCourses {
    key MANDT      : String(3);
    key CARRID     : String(3);
    key MEALNUMBER : String(8);
        // Associations
        MEAL       : Association to Meals
                         on  MEAL.MANDT      = MANDT
                         and MEAL.CARRID     = CARRID
                         and MEAL.MEALNUMBER = MEALNUMBER;
}

entity Desserts {
    key MANDT      : String(3);
    key CARRID     : String(3);
    key MEALNUMBER : String(8);
        HOT        : String(1);
        // Associations
        MEAL       : Association to Meals
                         on  MEAL.MANDT      = MANDT
                         and MEAL.CARRID     = CARRID
                         and MEAL.MEALNUMBER = MEALNUMBER;
}

// ─── Currency ────────────────────────────────────────────────

entity CurrencyRates {
    key MANDT : String(3);
    key KURST : String(4);
    key FCURR : String(5);
    key TCURR : String(5);
    key GDATU : Date;
        UKURS : Decimal(9, 5);
        FFACT : Decimal(9, 0);
        TFACT : Decimal(9, 0);
}

entity CurrencyDecimals {
    key CURRKEY : String(5);
        CURRDEC : Integer;
}

// ─── Views ───────────────────────────────────────────────────

@readonly
entity CustomerBusinessPartners as
    select from Customers {
        key MANDT,
        key ID,
            BUSINESSPARTNER.BUSPARTNUM,
            NAME,
            BUSINESSPARTNER.CONTACT,
            BUSINESSPARTNER.CONTPHONO,
            BUSINESSPARTNER.BUSPATYP
    };

@readonly
entity CarrierConnections       as
    select from Carriers {
        key MANDT,
        key CARRID,
            CARRNAME,
            CURRCODE,
        key CONNECTIONS.CONNID,
            CONNECTIONS.COUNTRYFR,
            CONNECTIONS.CITYFROM,
            CONNECTIONS.AIRPFROM,
            CONNECTIONS.COUNTRYTO,
            CONNECTIONS.CITYTO,
            CONNECTIONS.AIRPTO,
        key FLIGHTS.FLDATE,
            FLIGHTS.PRICE,
            FLIGHTS.CURRENCY,
            FLIGHTS.PLANETYPE,
            FLIGHTS.SEATSMAX,
            FLIGHTS.SEATSOCC,
            FLIGHTS.PAYMENTSUM,
            FLIGHTS.SEATSMAX_B,
            FLIGHTS.SEATSOCC_B,
            FLIGHTS.SEATSMAX_F,
            FLIGHTS.SEATSOCC_F
    };

@readonly
entity FlightSchedule           as
    select from Flights {
        key MANDT,
        key CARRID,
        key CONNID,
        key FLDATE,
            PRICE,
            CURRENCY,
            PLANETYPE,
            SEATSMAX,
            SEATSOCC,
            SEATSMAX_B,
            SEATSOCC_B,
            SEATSMAX_F,
            SEATSOCC_F,
            PAYMENTSUM,
            CARRIER.CARRNAME,
            CONNECTION.CITYFROM,
            CONNECTION.AIRPFROM,
            CONNECTION.CITYTO,
            CONNECTION.AIRPTO,
            CONNECTION.DEPTIME,
            CONNECTION.ARRTIME,
            CONNECTION.FLTIME,
            CONNECTION.DISTANCE,
            CONNECTION.DISTID,
            PLANE.PRODUCER   as PLANE_PRODUCER,
            PLANE.SEATSMAX   as PLANE_CAPACITY,
            PLANE.SEATSMAX_B as PLANE_CAPACITY_B,
            PLANE.SEATSMAX_F as PLANE_CAPACITY_F
    };

@readonly
entity BookingDetails           as
    select from Bookings {
        key MANDT,
        key CARRID,
        key CONNID,
        key FLDATE,
        key BOOKID,
            CUSTOMID,
            CLASS,
            FORCURAM,
            FORCURKEY,
            LOCCURAM,
            LOCCURKEY,
            ORDER_DATE,
            CANCELLED,
            RESERVED,
            PASSNAME,
            PASSFORM,
            LUGGWEIGHT,
            WUNIT,
            AGENCYNUM,
            CUSTOMER.NAME    as CUSTOMER_NAME,
            CUSTOMER.EMAIL   as CUSTOMER_EMAIL,
            CUSTOMER.CITY    as CUSTOMER_CITY,
            CUSTOMER.COUNTRY as CUSTOMER_COUNTRY,
            AGENCY.NAME      as AGENCY_NAME,
            AGENCY.CITY      as AGENCY_CITY,
            FLIGHT.PRICE     as FLIGHT_PRICE,
            FLIGHT.CURRENCY  as FLIGHT_CURRENCY,
            FLIGHT.PLANETYPE as FLIGHT_PLANETYPE
    };
