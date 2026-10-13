import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { LanStatus, NearbyDevice, PairedDevice, PairingStarted, PairRequest, StartTransferRequest, TransferOffer, UpdateLanSettingsRequest } from '../types/lan';

/** 局域网设备互传：开关与名字、附近的设备、配对 */
class LanService extends BaseService {
  async getStatus(): Promise<ApiResult<LanStatus>> {
    return this.executeWithLoading(async () => this.client.invoke<LanStatus>('get_lan_status'));
  }

  async updateSettings(request: UpdateLanSettingsRequest): Promise<ApiResult<LanStatus>> {
    return this.executeWithLoading(async () => this.client.invoke<LanStatus>('update_lan_settings', { request }));
  }

  async getNearbyDevices(): Promise<ApiResult<NearbyDevice[]>> {
    return this.executeWithLoading(async () => this.client.invoke<NearbyDevice[]>('get_nearby_devices'));
  }

  async refreshNearbyDevices(): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('refresh_nearby_devices'));
  }

  async addDeviceByAddress(address: string): Promise<ApiResult<NearbyDevice>> {
    return this.executeWithLoading(async () => this.client.invoke<NearbyDevice>('add_device_by_address', { address }));
  }

  async startPairing(fingerprint: string): Promise<ApiResult<PairingStarted>> {
    return this.executeWithLoading(async () => this.client.invoke<PairingStarted>('start_pairing', { fingerprint }));
  }

  /** 发起方确认两边数字一致（对方也同意了才完成配对） */
  async confirmPairing(pairingId: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('confirm_pairing', { pairingId }));
  }

  async cancelPairing(pairingId: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('cancel_pairing', { pairingId }));
  }

  async respondPairRequest(requestId: string, accept: boolean): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('respond_pair_request', { requestId, accept }));
  }

  async getPendingPairRequests(): Promise<ApiResult<PairRequest[]>> {
    return this.executeWithLoading(async () => this.client.invoke<PairRequest[]>('get_pending_pair_requests'));
  }

  async getPairedDevices(): Promise<ApiResult<PairedDevice[]>> {
    return this.executeWithLoading(async () => this.client.invoke<PairedDevice[]>('get_paired_devices'));
  }

  async unpairDevice(fingerprint: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('unpair_device', { fingerprint }));
  }

  /** 发送到已配对的设备：返回后台任务编号 */
  async startTransfer(request: StartTransferRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(async () => this.client.invoke<string>('start_lan_transfer', { request }));
  }

  async respondTransferOffer(transferId: string, accept: boolean): Promise<ApiResult<void>> {
    return this.executeWithLoading(async () => this.client.invoke<void>('respond_transfer_offer', { transferId, accept }));
  }

  async getPendingTransfer(): Promise<ApiResult<TransferOffer | null>> {
    return this.executeWithLoading(async () => this.client.invoke<TransferOffer | null>('get_pending_transfer'));
  }
}

export const lanService = new LanService();
