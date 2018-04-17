const exec = require('child_process').exec
const path = require('path')
const fs = require('fs')
const tmp = require('tmp')

function SalesforceDX(username, verbose = false) {
    if (!username) throw new Error('Missing username')
    this._verbose = verbose
    this._username = username

    this._logIfVerbose = (msg) => {
        if (this._verbose) this._log(msg)
    }
    this._log = (msg) => {
        console.log(`SFDX - ${msg}`)
    }
}

/**
 * Issue a bulk UPSERT request using SalesforceDX for the supplied object, using data 
 * from the supplied file
 * @param {String} objname 
 * @param {String} filename 
 * @param {String} externalId 
 */
SalesforceDX.prototype.bulkUpsert = function(objname, filename, externalId) {
    return this.bulkRequest(`sfdx force:data:bulk:upsert -u ${this._username} -s ${objname} -f ${filename} -i ${externalId}`, objname)
}

/**
 * Does a bulk delete of the supplied object using ID's from the supplied file
 * @param {*} objname 
 * @param {*} filename 
 */
SalesforceDX.prototype.bulkDelete = function(objname, filename) {
    return this.bulkRequest(`sfdx force:data:bulk:delete -u ${this._username} -s ${objname} -f ${filename}`, objname)
}

/**
 * Does a bulk request for the supplied object using SalesforceDX
 * @param {String} cmd 
 * @param {String} objname 
 */
SalesforceDX.prototype.bulkRequest = function(cmd, objname) {
    return new Promise((resolve, reject) => {
        this.executeSFDXCommand(cmd).then(data => {
            let state = data.result[0].state
            let id = data.result[0].id
            let jobId = data.result[0].jobId
            this._log(`issued bulk request to object (${objname}) - id ${id}, jobId ${jobId} - state: ${state}`)
            this._logIfVerbose(JSON.stringify(data))

            // wait for bulk operation to finish
            let doWait = () => {
                global.setTimeout(() => {
                    this._log(`asking for bulk status for id ${id}, jobId ${jobId}`)
                    this.executeSFDXCommand(`sfdx force:data:bulk:status -u ${this._username} --batchid ${id} --jobid ${jobId}`).then(data => {
                        let state = data.result[0].state
                        this._log(`received bulk status for id ${id}, jobId ${jobId} - state: ${state}`)
                        this._logIfVerbose(JSON.stringify(data))

                        if (state === 'Completed') {
                            // completed
                            return resolve()
                        } else if (state === 'Failed') {
                            // failed
                            return reject()
                        } else {
                            // keep waiting
                            this._log('waiting...')
                        }
                        doWait()
                    })
                }, 10000)
            }
            doWait()
        })
    })
}

/**
 * Does a query for Ids from the supplied object using the supplied 
 * SOQL WHERE query, pipes the result to a tmp-file to avoid stdin buffer 
 * overruns, creates a CSV file with the IDs a does a SalesforceDX bulk delete 
 * of the records.
 * 
 * @param {String} objname Object name to query i.e. Account
 * @param {String} where SOQL WHERE clause - must be specified
 */
SalesforceDX.prototype.bulkQueryAndDelete = function(objname, where) {
    return new Promise((resolve, reject) => {
        this._log(`issueing SOQL using WHERE clause of '${where}' on ${objname} object`)
        this.executeSFDXCommand(`sfdx force:data:soql:query -u ${this._username} -q "SELECT Id FROM ${objname} WHERE ${where}`).then(data => {
            let count = data.result.records.length
            this._log(`received ${count} records`)
            if (!count) {
                return reject()
            }
            
            // build output filename
            tmp.file((err, tmppath, fd, callback) => {
                const deleteIds = fs.createWriteStream(tmppath)
                deleteIds.write('"Id"\n')
                data.result.records.map(r => r.Id).forEach(id => {
                    deleteIds.write(`${id}\n`)
                })
                deleteIds.close()
                this._logIfVerbose(`wrote CSV file ${tmppath} with ${objname} Ids to delete`)

                // do command
                this.bulkDelete(objname, tmppath).then(() => {
                    resolve()
                }).catch(() => {
                    reject()
                }).then(() => {
                    // clean up tmp file
                    callback()
                })
            })
        })
    })
}

/**
 * Utility function to issue a call using SalesforceDX in the shell and returnsthe 
 * data as a JSON object. Method will append --json to the command if not specified.
 * @param {String} cmd 
 */
SalesforceDX.prototype.executeSFDXCommand = function(cmd) {
    this._logIfVerbose(`received command: ${cmd}`)
    let command = cmd
    if (cmd.indexOf(' --json') < 0) {
        command += ' --json'
        this._logIfVerbose(`command (modified): ${command}`)
    }
    return new Promise((resolve, reject) => {
        // as output may exceed the node.js stdin buffer size we create a tmp file we 
        // pipe the ouput to and read that back in
        tmp.file((err, tmppath, fd, callback) => {
            command += ` > ${tmppath}`
            exec(command, (err, stdout, stderr) => {
                if (err) {
                    this._logIfVerbose('command resulted in error in shell')
                    return reject(err)
                }
                
                // read file
                let input = fs.readFileSync(tmppath).toString()

                // parse
                this._logIfVerbose('command succeeded in shell')
                let output = JSON.parse(input)

                // we're done with tmp file
                callback()

                // resolve
                resolve(output)
            })
        })
    
        
    })
}

/**
 * Queries force:org:display to ensure the supplied username is valid for a connected 
 * org.
 */
SalesforceDX.prototype.ensureOrgConnected = function() {
    return new Promise((resolve, reject) => {
        this.executeSFDXCommand(`sfdx force:org:display -u ${this._username}`).then(data => {
            if (data.result.connectedStatus !== 'Connected') {
                return reject(data.result.connectedStatus)
            } else {
                return resolve()
            }
        }).catch(err => {
            reject(err)
        })
    })
}

module.exports = SalesforceDX
