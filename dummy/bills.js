const bills = [
    {
        group_id: 'test-group-1',
        items: [
            { nominal: 10000, who_to_paid: ["A"], paid_by: "B" },
        ],
        tax: 0,
        service: 0,
        discount: 0,
    },
    {
        group_id: 'test-group-1',
        items: [
            { nominal: 5000, who_to_paid: ["C"], paid_by: "B" },
        ],
        tax: 0,
        service: 0,
        discount: 0,
    },
    {
        group_id: 'test-group-1',
        items: [
            { nominal: 5000, who_to_paid: ["B"], paid_by: "A" },
        ],
        tax: 0,
        service: 0,
        discount: 0,
    }
];

const billsWithFees = [
    {
        group_id: 'test-group-1',
        items: [
            { nominal: 10000, who_to_paid: ["A"], paid_by: "B" }
        ],
        tax: 0.1, // 10% tax
        service: 0.05, // 5% service
        discount: 0.02 // 2% discount
    }
];

const billsWithSharing = [
    {
        group_id: 'test-group-1',
        items: [
            { nominal: 10000, who_to_paid: ["A", "B", "C"], paid_by: "D" }
        ],
        tax: 0,
        service: 0,
        discount: 0
    }
];

const billsWithStandardRates = [
    {
        group_id: 'test-group-1',
        items: [
            { nominal: 100000, who_to_paid: ["A", "B"], paid_by: "C" }
        ],
        tax: 0.11, // 11% tax
        service: 0.06, // 6% service
        discount: 0 // no discount
    }
];

module.exports = {
    bills,
    billsWithFees,
    billsWithSharing,
    billsWithStandardRates
};