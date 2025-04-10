'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

class BaseModel {
    constructor(data) {
        this.data = data;
    }

    save() {
        // Logic to save the model data
        console.log('Saving data:', this.data);
    }

    delete() {
        // Logic to delete the model data
        console.log('Deleting data:', this.data);
    }
}