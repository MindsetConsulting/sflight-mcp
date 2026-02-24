const cds = require('@sap/cds');

module.exports = class FlightsService extends cds.ApplicationService {

    init() {
        const { CarrierConnections } = this.entities;

        this.on('getFlightsOnDate', async (req) => {
            const { flightDate } = req.data;
            if (!flightDate) {
                return req.reject(400, 'Parameter flightDate is required');
            }
            return SELECT.from(CarrierConnections).where({ FLDATE: flightDate });
        });

        return super.init();
    }
};
